export const meta = {
  name: 'deep-adversarial-audit',
  description: 'Audit avversariale anilist-recommender: mappa → attacca → verifica → severità',
  phases: [
    { title: 'Map', detail: 'mappatura repo e scan plan' },
    { title: 'Attack', detail: 'flotta avversaria per ruolo×partizione' },
    { title: 'Verify', detail: 'verifica avversariale indipendente per batch' },
  ],
}

const REPO = args.repoPath

const SEV = { type: 'string', enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] }

const FINDING = { type: 'object', properties: {
  id: { type: 'string' },
  title: { type: 'string' },
  file: { type: 'string' },
  line: { type: 'number' },
  evidence: { type: 'string' },
  severity: SEV,
  suggestedFix: { type: 'string' },
}, required: ['id', 'title', 'file', 'line', 'evidence', 'severity', 'suggestedFix'] }

const FINDINGS = { type: 'object', properties: {
  findings: { type: 'array', items: FINDING },
}, required: ['findings'] }

const MAP_SCHEMA = { type: 'object', properties: {
  isML: { type: 'boolean' },
  totalLoc: { type: 'number' },
  scanPlan: { type: 'array', items: { type: 'object', properties: {
    role: { type: 'string' },
    scope: { type: 'string' },
    files: { type: 'array', items: { type: 'string' } },
    loc: { type: 'number' },
  }, required: ['role', 'scope', 'files', 'loc'] } },
}, required: ['isML', 'totalLoc', 'scanPlan'] }

const VERDICT = { type: 'object', properties: {
  verdicts: { type: 'array', items: { type: 'object', properties: {
    id: { type: 'string' },
    verdict: { type: 'string', enum: ['CONFIRMED', 'REJECTED', 'SPECULATIVE'] },
    severity: SEV,
    reason: { type: 'string' },
  }, required: ['id', 'verdict', 'severity', 'reason'] } },
}, required: ['verdicts'] }

const COMMON = `Regole comuni: riporta solo findings con evidenza testuale citata dal codice (file:riga assoluta o repo-relativa). Un finding per problema distinto, raggruppa i sintomi della stessa causa. Proporre fix come descrizione/abbozzo diff, MAI applicare modifiche. Non delegare: nessun subagent. Lavora SOLO sui file del tuo scope. Le repo path base è ${REPO}.`

const ROLE_PROMPTS = {
  security: `Sei un Security Adversary. Missione: vulnerability sfruttabili e postura di sicurezza carenti.
Cerca: injection (command/path/template/XSS), secrets esposti, deserializzazione insicura, auth/permessi mancanti su endpoint, IDOR, uso insicuro di API.
NON segnalare: teorie senza input raggiungibile da esterno; hardening headers su tool locali; secrets in fixture/test dichiarati placeholder; comportamenti voluti (script con input fidato per design).
${COMMON}`,
  logic: `Sei un Logic & Edge-Case Hunter. Missione: bug logici e casi limite.
Cerca: off-by-one, < vs <=, null non gestiti, condizioni al contorno (stringhe vuote, zero, negativi, valori massimi), errori gestiti in silenzio (catch vuoto, default che maschera fallimenti), race condition/TOCTOU/shared mutable state/lock mancanti, ordine di init.
NON segnalare: guardie già presenti a monte (verifica con grep/read, non assumere); input impossibili per costruzione del tipo; stile e naming.
${COMMON}`,
  contract: `Sei un Contract Breaker. Missione: incoerenze tra interfacce dichiarate e implementazione.
Cerca: mismatch firma/contratto, tipi promessi vs ritornati, incoerenze tra moduli (contratti impliciti violati), endpoint/schema promessi non rispettati, errori promessi ma mai sollevati.
NON segnalare: divergenze cosmetic nei commenti; contratti interni privati con un solo chiamante coerente; imprecisioni di tipo dove nessun contratto dichiarato.
${COMMON}`,
  performance: `Sei un Performance & Resource Abuser. Missione: sprechi di risorse e degradi concreti.
Cerca: memory leak (cache senza bound/eviction, risorse mai rilasciate), I/O sincrono bloccante in contesti async, query/loop inefficienti (N+1, O(n²) su collezioni grandi per costruzione), spawn/processi non gestiti, polling senza limiti.
NON segnalare: codice freddo (setup/init) con complessità irrilevante; micro-ottimizzazioni senza misura; complessità teorica su collezioni limitate per contratto.
${COMMON}`,
  'test-quality': `Sei un Test-Quality Skeptic. Missione: test che danno falsa sicurezza.
Cerca: test senza asserzioni significative, mock eccessivo (test del mock, non del comportamento), coverage fasulla (esegue righe senza verificare output), flaky per costruzione (tempo reale, ordine, rete, rand senza seed, stato globale condiviso), test che verificano l'implementazione e non il contratto.
NON segnalare: assenza di test in aree non critiche (al più INFO); test lenti ma deterministici; smoke test dichiarati tali.
${COMMON}`,
  dependency: `Sei un Dependency & Supply-Chain Checker. Missione: rischi nella catena delle dipendenze.
Cerca: versioni con CVE note, licenze incompatibili con MIT, dipendenze non mantenute, fork non ufficiali, lockfile assenti dove richiesti, range larghi su dipendenze critiche senza lock.
NON segnalare: dipendenze aggiornabili senza riscontro di sicurezza o break; transitive non risolvibili senza major upgrade; pinning stretto di per sé.
${COMMON}`,
}

phase('Map')
log('Mappatura repo: anilist-recommender')
const map = await agent(`Analizza la repo ${REPO} (anilist-recommender: TypeScript, Node ≥22, Hono backend + React/Vite frontend, test node:test, ~2.5k LOC). Elenco file noti: src/server/{config,anilist,profile,candidates,scoring,franchise,llm,recommend,api,setup,index}.ts, src/shared/{types,strings}.ts, src/ui/{App,api,main}.tsx? (api.ts è .ts), src/ui/components/{UsernameForm,ProfilePanel,RecoCard,SetupWizard}.tsx, src/ui/styles.css, tests/{profile,scoring,api,llm,setup}.test.ts, scripts/record-fixtures.mjs, fixtures/*.json, package.json, tsconfig.json, vite.config.ts, .github/workflows/ci.yml.
Verifica i LOC reali con wc -l. Escludi node_modules/, dist/, data/, docs/, fixtures/ (dati, non codice auditabile — ma includili se contengono segreti), pnpm-lock.yaml.
isML: true solo se presente training/inference ML nel codice della repo (chiamate a LLM via HTTP non contano come pipeline ML).
Produci scanPlan: 10-14 partizioni con scope disgiunti, ruoli ripetuti sui target giusti (security su input/API/process spawn; logic su engine e setup; contract su types/api/ui-client; performance su anilist/recommend/setup; test-quality sui test; dependency su package/lock/CI). Ogni partizione ≤ ~1k LOC.`, { label: 'map', phase: 'Map', schema: MAP_SCHEMA })

log(`scan plan: ${map.scanPlan.length} partizioni, isML=${map.isML}`)

phase('Attack')
const attacks = await parallel(map.scanPlan.map((unit, i) => () =>
  agent(`${ROLE_PROMPTS[unit.role] ?? ROLE_PROMPTS.logic}

Il tuo scope: ${unit.scope}
File (repo-relativi a ${REPO}): ${unit.files.join(', ')}

Rispondi SOLO con l'oggetto findings richiesto. id progressivi del tipo ${unit.role}-${i + 1}.<n>.`, {
    label: `attack:${unit.role}:${unit.scope.slice(0, 24)}`,
    phase: 'Attack',
    schema: FINDINGS,
  }).then(r => r ? { unit, findings: r.findings } : null)
))
const batches = attacks.filter(Boolean)
const allFindings = batches.flatMap(b => b.findings.map(f => ({ ...f, agent: b.unit.role, scope: b.unit.scope })))
log(`${allFindings.length} findings grezzi da ${batches.length} attacker`)

phase('Verify')
// batch per file: un verifier indipendente per gruppo di findings sullo stesso file
const byFile = new Map()
for (const f of allFindings) {
  const key = f.file
  if (!byFile.has(key)) byFile.set(key, [])
  byFile.get(key).push(f)
}
const groups = [...byFile.entries()]
log(`${groups.length} verifier (batch per file)`)

const verified = await parallel(groups.map(([file, group]) => () =>
  agent(`Sei un verifier avversariale indipendente per la repo ${REPO}. Ricevi ${group.length} findings trovati da attacker (ruoli vari) sul file ${file}.

${JSON.stringify(group, null, 1)}

Per OGNI finding: leggi il codice reale nel contesto (file intero, chiamanti, guardie a monte, test che lo coprono) e prova a SMONTARLO. Verdict CONFIRMED solo se la logica regge end-to-end sul codice reale; REJECTED se falso o già mitigato; SPECULATIVE se non provabile dal codice. Assegna severità finale con questa rubrica:
- CRITICAL: impatto alto + scatta sempre o sfruttabile banalmente da input esterno
- HIGH: impatto alto + frequente, oppure medio + sempre
- MEDIUM: impatto medio + frequente, o alto ma raro
- LOW: impatto basso/locale + raro, debito tecnico non manifestabile oggi
- INFO: osservazione utile, nessun difetto dimostrato
In dubbio tra due livelli: scendi di uno. Sfruttabilità non alza mai sopra l'impatto reale. Il campo id deve combaciare con quello in input.`, {
    label: `verify:${file.split('/').pop()}`,
    phase: 'Verify',
    schema: VERDICT,
  }).then(v => ({ file, group, verdicts: v ? v.verdicts : [] }))
))

const results = verified.filter(Boolean).flatMap(v => {
  return v.group.map(f => {
    const verdict = v.verdicts.find(x => x.id === f.id) ?? { verdict: 'SPECULATIVE', severity: 'INFO', reason: 'verifier non ha prodotto verdetto' }
    return { ...f, verification: verdict }
  })
})

const confirmed = results.filter(f => f.verification.verdict === 'CONFIRMED')
const rejected = results.filter(f => f.verification.verdict !== 'CONFIRMED')
log(`confermati: ${confirmed.length}, scartati: ${rejected.length}`)

return {
  map: { isML: map.isML, totalLoc: map.totalLoc, partitions: map.scanPlan.length },
  confirmed,
  rejected: rejected.map(f => ({ id: f.id, title: f.title, agent: f.agent, file: f.file, reason: f.verification.reason, verdict: f.verification.verdict })),
}