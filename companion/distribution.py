"""Build a public Windows ZIP without touching the personal installation.

Only explicitly listed runtime files are read. Private state, pairing files,
captured pages, diagnostics, tests and development files never enter the ZIP.
"""
import ast
import json
from pathlib import Path
import re
import tempfile
import zipfile


RUNTIME_FILES = (
    'manifest.json', '_locales/en/messages.json', '_locales/it/messages.json',
    'extension/strings.js', 'extension/i18n.js', 'extension/_locales/en/messages.json', 'extension/_locales/it/messages.json',
    'companion/connection.py', 'extension/background.js', 'extension/content.js',
    'extension/core.js', 'extension/parser.js', 'extension/search.js', 'extension/profiles.js',
    'extension/ui/index.html', 'extension/ui/ui.js', 'extension/ui/ui.css',
    'extension/ui/demo.js', 'extension/ui/creator.jpg', 'extension/icons/rewards-adviser.svg', 'extension/icons/icon16.png',
    'extension/icons/icon32.png', 'extension/icons/icon48.png',
    'extension/icons/icon128.png', 'companion/server.py', 'companion/launcher.py',
    'companion/phone_native.py', 'companion/phone_vision.py',
    'companion/phone_ocr.ps1', 'companion/phone_reader.py',
)

PUBLIC_PROFILES = """(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.RewardsProfiles=api;})(globalThis,()=>{
 'use strict';
 const presets=Object.freeze({
  reader1:Object.freeze({slot:1,alias:'Account 1',email:'',coordinator:false,autoRefresh:true}),
  reader2:Object.freeze({slot:2,alias:'Account 2',email:'',coordinator:false,autoRefresh:true}),
  reader3:Object.freeze({slot:3,alias:'Account 3',email:'',coordinator:false,autoRefresh:true}),
  panel:Object.freeze({slot:null,alias:'Pannello',email:'',coordinator:true,autoRefresh:false})
 });
 function apply(key,current={}){if(key==='custom')return {...current};if(!Object.hasOwn(presets,key))throw new Error('Scegli Lettore 1, Lettore 2, Lettore 3 oppure Pannello.');return {...current,...presets[key]};}
 function keyFor(config={}){
  const key=Object.keys(presets).find(k=>Object.entries(presets[k]).every(([field,value])=>(field==='email'?String(config[field]||'').trim().toLowerCase():config[field])===value));
  if(key)return key;
  if(config.slot===null&&!config.coordinator&&!config.email&&(!config.alias||config.alias==='Account'))return '';
  return 'custom';
 }
 return {presets,apply,keyFor};
});
"""

PROFILE_OPTIONS = """<select id="profile" required><option value="">Scegli il ruolo…</option><option value="reader1">Lettore 1 — Account 1</option><option value="reader2">Lettore 2 — Account 2</option><option value="reader3">Lettore 3 — Account 3</option><option value="panel">Pannello e promemoria</option><option value="custom">Personalizzato</option></select>"""
SLOT_OPTIONS = """<select id="slot"><option value="">Solo pannello</option><option value="1">Account 1</option><option value="2">Account 2</option><option value="3">Account 3</option></select>"""

README = """<!doctype html>
<html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Rewards Adviser — guida</title>
<style>body{font-family:Segoe UI,Arial,sans-serif;line-height:1.65;max-width:860px;margin:48px auto;padding:0 24px;background:#f5f7fb;color:#17233b}main{background:white;padding:32px;border-radius:18px}h1,h2{line-height:1.25}h2{margin-top:32px}code{background:#edf1f8;padding:2px 5px;border-radius:4px}a{color:#174bad}.note{background:#edf4ff;padding:16px;border-radius:10px}li{margin:10px 0}</style></head>
<body><main><h1>Rewards Adviser</h1><p>Un pannello locale per seguire fino a tre account Microsoft Rewards su un PC Windows, con aggiornamenti e promemoria. Ogni persona usa i propri account e la propria chiave locale.</p>
<p class="note"><strong>Aggiornamento 1.4.0:</strong> incluso il lettore locale facoltativo delle letture articoli Bing da un telefono collegato al PC. Richiede una <strong>calibrazione privata</strong> del dispositivo, degli account e del carattere: non è pronta automaticamente per altri PC e non è inclusa nello ZIP condivisibile. Il lettore parte in pausa; le conferme manuali continuano a funzionare. Dopo un aggiornamento riavvia AVVIA.cmd e premi <strong>Ricarica</strong> nella pagina delle estensioni di tutti i profili collegati, poi aggiorna Rewards. Le associazioni salvate restano valide.</p>
<h2>Lingua e account personali</h2><p>La lingua dell’estensione segue quella del browser: italiano o inglese, con inglese per le altre lingue. In Impostazioni scegli Lettore 1, 2 o 3 e indica il browser e la tua email Microsoft. Puoi usare anche un solo account; la versione pubblica parte senza identità precompilate. L’email può essere rilevata dalla pagina Rewards se lasci il campo vuoto. L’estensione legge la sessione già aperta in quel profilo: non effettua l’accesso usando soltanto l’email.</p><h2>Chiave generata su questo PC</h2><p>Il primo avvio genera una chiave casuale, diversa su ogni PC e utente Windows, senza usare identificativi hardware. È salvata in <code>%LOCALAPPDATA%\RewardsAdviser\connection.json</code> e riutilizzata dopo i riavvii e da altre cartelle del progetto. La copia in <code>.state/config.json</code> e il file locale dell’estensione restano privati. Un’installazione già attiva mantiene la propria chiave durante la migrazione.</p><h2>1. Prepara il PC</h2><ol>
<li>Installa <strong>Python 3.11 o successivo</strong> dal <a href="https://www.python.org/downloads/windows/">sito ufficiale Python per Windows</a>. Durante l'installazione abilita il launcher Python oppure l'opzione per aggiungere Python a PATH.</li>
<li>Estrai tutto il file ZIP in una cartella normale dove puoi scrivere. Non avviare i file dall'interno dello ZIP. Tieni insieme <code>manifest.json</code>, <code>extension</code> e <code>companion</code>.</li>
<li>Apri <strong>AVVIA.cmd</strong>. Crea la tua chiave e avvia il collegamento sul PC. Ripeti questo passaggio quando riaccendi il PC. <strong>FERMA.cmd</strong> ferma il collegamento locale.</li>
</ol>
<h2>2. Carica l'estensione</h2><p>In ogni profilo del browser che vuoi collegare, apri la pagina delle estensioni: <code>edge://extensions</code>, <code>chrome://extensions</code> oppure <code>brave://extensions</code>. Attiva la modalità sviluppatore, scegli <strong>Carica estensione non pacchettizzata</strong> e seleziona la <strong>cartella principale estratta che contiene manifest.json</strong>. Poi apri Rewards Adviser dalla barra del browser.</p>
<h2>3. Scegli il ruolo di ciascun profilo</h2><ul>
<li>Per il primo account scegli <strong>Lettore 1</strong> e premi <strong>Salva e collega</strong>. Apri <a href="https://rewards.bing.com/">Microsoft Rewards</a> in quel profilo. L'email si rileva automaticamente quando è presente nella pagina.</li>
<li>Se usi altri account, collegali da altri profili scegliendo <strong>Lettore 2</strong> e <strong>Lettore 3</strong>. Ogni lettore occupa uno slot diverso. Puoi usare anche un solo account.</li>
<li>Se vuoi un pannello separato, scegli <strong>Pannello e promemoria</strong> in un altro profilo, ad esempio Edge. Lascia un solo coordinatore dei promemoria attivo su tutto il PC.</li>
<li><strong>Un solo account e un solo browser?</strong> Scegli Lettore 1, apri Impostazioni avanzate e attiva <strong>Coordinatore dei promemoria</strong> nello stesso profilo. Non serve un secondo browser.</li>
</ul><p>In Impostazioni avanzate puoi cambiare il nome visualizzato e il browser, oppure inserire facoltativamente l'email Microsoft se non è rilevabile. Controlla che l'email letta corrisponda all'account atteso. Se cambi sessione Microsoft, usa <strong>Nuova associazione</strong> e salva di nuovo.</p>
<h2>Ricerche Bing: PC e telefono</h2><p>Il lettore chiede i contatori al pannello Bing con una <strong>richiesta GET autenticata</strong>, usando la sessione già aperta nel browser. Apri <a href="https://www.bing.com/">Bing</a> nel profilo di ogni lettore e accedi con <strong>la stessa email Microsoft mostrata da Rewards in quel profilo</strong>, poi aggiorna Rewards. Non basta essere collegati a Rewards se Bing mostra un altro account o non è collegato.</p><p>Se la risposta in background è anonima o non disponibile, il lettore prova dalla scheda Bing dello stesso profilo: riusa una scheda esistente oppure ne apre una inattiva una sola volta. Legge indirizzi fissi con richieste GET e <strong>non esegue ricerche</strong>. Controlla l'email prima e dopo la lettura e mantiene gli stessi controlli sull'identità dell'account. Se Bing non è collegato, apri la scheda e accedi manualmente con lo stesso account di Rewards, poi aggiorna di nuovo.</p><p>Quando Microsoft indica una quota unica, chiamata <code>PcCombined</code>, il pannello mostra una sola riga <strong>Ricerche Bing · PC + telefono</strong>. Negli altri casi legge separatamente i contatori PC e telefono forniti da Microsoft. Non indovina i limiti dal numero di punti o dal tipo di account e non conta due volte la quota combinata. I dati assenti o non verificabili restano <strong>non rilevati</strong>: non significano zero o giornata completata.</p>
<h2>Letture articoli Bing dal telefono</h2><p>I <strong>30 punti degli articoli nell'app Bing</strong> sono distinti dalle ricerche. Per seguirli automaticamente il programma può leggere il contatore visualizzato sul telefono tramite Collegamento al telefono e OCR Windows locale, senza cambiare il carattere del telefono. Non usa una fonte web per questi punti.</p><p>Serve un <a href="https://support.microsoft.com/en-us/windows/apps/phonelink/supported-devices-for-phone-link-experiences">telefono compatibile con Schermo telefono</a>, già abbinato al PC. Consulta le <a href="https://support.microsoft.com/en-us/windows/apps/phonelink/phone-link-requirements-and-setup">istruzioni Microsoft per l'abbinamento</a> e la <a href="https://support.microsoft.com/en-US/Windows/Apps/PhoneLink/setting-up-and-using-phone-screen-in-the-phone-link">guida a Schermo telefono</a>. Gli account da seguire devono essere già salvati nell'app Bing; accessi, verifiche e permessi si completano personalmente.</p><p class="note"><strong>Preparazione necessaria:</strong> la lettura richiede una <strong>calibrazione privata</strong> delle immagini che identificano dispositivo, account, schermate e carattere. Quei riferimenti restano in <code>.state/phone-reader</code> e <strong>non sono inclusi nel pacchetto condivisibile</strong>. Un altro PC parte con il lettore <strong>in pausa</strong>; se attivato senza riferimenti validi mostra che il riconoscimento deve essere configurato (<code>calibration-needed</code>). Il pacchetto non contiene una procedura guidata di calibrazione. Senza tale preparazione puoi usare normalmente i dati web e la conferma manuale.</p><ol><li>Con una calibrazione valida, mantieni il PC acceso e il telefono <strong>connesso, acceso e sbloccato</strong>. Lascia aperta la finestra Schermo telefono, non ridotta a icona, sull'app Bing e sulla schermata del profilo riconosciuta.</li><li>Nel pannello abilita <strong>Articoli Bing dal Galaxy → Lettura automatica</strong>. Il lettore tenta un ciclo ogni <strong>120 secondi</strong>, dopo almeno <strong>15 secondi</strong> senza attività sul PC.</li><li>Durante il ciclo può portare temporaneamente davanti la finestra del telefono e passare fra gli account già salvati in Bing. Controlla l'identità prima e dopo ciascuna lettura e prova a ripristinare l'account iniziale e la finestra usata prima. Se usi il PC, cambia la schermata, manca il telefono o compare un accesso da completare, il ciclo si interrompe.</li><li>Le letture valide mostrano <strong>Letto dal Galaxy</strong>, punti e ora. Usa l'interruttore per mettere il lettore in pausa in qualsiasi momento. Se non vuoi che la finestra venga portata davanti, lascialo in pausa.</li></ol><p>Il lettore <strong>non apre articoli per guadagnare punti, non esegue ricerche, check-in o riscatti</strong>. Legge solo il contatore e naviga fra schermate e account riconosciuti. Dopo cinque minuti o al cambio giorno la lettura precedente resta visibile ma non entra nel totale corrente e nei promemoria automatici; un dato non leggibile resta sconosciuto, senza diventare zero.</p><p><strong>Alternativa manuale:</strong> se manca una lettura attuale, apri <strong>Bing sul telefono → Letture articoli Bing</strong>, inserisci i punti realmente controllati nell'app, da 0 a 30, e premi <strong>Salva</strong>. È una conferma per l'account selezionato e per oggi. Una nuova lettura automatica valida torna ad avere precedenza e non viene sommata alla conferma manuale. Check-in e altre attività dell'app restano manuali.</p>
<h2>Aggiornamenti e limiti</h2><p>Mantieni aperta una scheda Rewards per ogni lettore. I lettori possono ricaricarla ogni due minuti; il pannello mostra l'ultima lettura disponibile. I promemoria arrivano ogni dieci minuti per le attività incomplete rilevate, se browser, notifiche e collegamento locale sono attivi.</p><p>Questa versione usa la giornata italiana e il fuso <strong>Europe/Rome</strong>. Check-in e altre attività dell'app restano manuali; le letture articoli possono provenire dal telefono soltanto dopo la preparazione privata descritta sopra. I totali sono parziali quando mancano dati. L'estensione non esegue ricerche o attività Rewards al posto tuo.</p>
<h2>Privacy e chiave personale</h2><p>Il collegamento usa soltanto <code>127.0.0.1:18743</code> sul tuo PC. L'estensione legge le pagine Rewards e i contatori Bing del profilo e conserva localmente nomi, email, progressi e attività manuali. Questo programma non invia questi dati a un servizio remoto e non legge password. Per leggere Bing il browser usa la propria sessione: l'estensione <strong>non estrae né esporta cookie o token Microsoft</strong>. Prima di unire i contatori controlla che l'email di Bing corrisponda a quella di Rewards e mantiene il collegamento all'identità verificata. Se l'identità non è verificabile o cambia, quei contatori non vengono usati. Microsoft e il browser continuano a gestire i loro normali servizi.</p><p>I dati del collegamento sono in <code>.state</code> nella cartella estratta: <code>config.json</code> contiene la chiave e <code>state.json</code> i progressi. Il browser conserva impostazioni e una copia dei dati nel proprio profilo locale, normalmente sotto <code>%LOCALAPPDATA%</code> su Windows. All'avvio vengono creati anche <code>extension/local-link.json</code> e <code>ABBINAMENTO-LOCALE.txt</code> per il collegamento automatico.</p><p class="note"><strong>Condividi soltanto lo ZIP originale.</strong> Dopo AVVIA la cartella contiene la tua chiave e può contenere dati dei tuoi account: non inoltrarla e non ricomprimerla. Il pacchetto originale non contiene chiavi, email personali, pagine salvate o progressi. Ogni destinatario genera una chiave nuova al primo avvio.</p><p>Per eliminare i dati, ferma il collegamento e rimuovi l'estensione da ogni profilo del browser; puoi poi eliminare la cartella estratta, compresi <code>.state</code> e i file di abbinamento. I dump diagnostici esportati a mano restano dove li hai salvati.</p>
<p>Per il lettore del telefono, le immagini dello schermo e i risultati OCR sono elaborati in memoria sul PC. Si conservano soltanto i piccoli riferimenti privati di calibrazione e i contatori con data e ora: non una cronologia delle schermate o dei testi OCR. I riferimenti di identità non vanno condivisi e, come le altre informazioni in <code>.state</code>, sono esclusi dallo ZIP pubblico.</p>
<h2>Distribuzione</h2><p>Questo pacchetto si installa localmente da cartella. Una futura pubblicazione su uno store richiede un adattamento del collegamento locale e la procedura dello store: <a href="https://learn.microsoft.com/en-us/microsoft-edge/extensions/publish/publish-extension">guida ufficiale alla pubblicazione su Microsoft Edge Add-ons</a>.</p>
</main></body></html>
"""


def _command(action):
    """Locate a supported Python interpreter without embedding a machine path."""
    return f'''@echo off
setlocal
cd /d "%~dp0"
py -3 -c "import sys;sys.exit(0 if sys.version_info >= (3,11) else 1)" >nul 2>&1
if not errorlevel 1 (
 py -3 "%~dp0companion\\launcher.py" {action}
 goto finished
)
python -c "import sys;sys.exit(0 if sys.version_info >= (3,11) else 1)" >nul 2>&1
if not errorlevel 1 (
 python "%~dp0companion\\launcher.py" {action}
 goto finished
)
echo Installa Python 3.11 o successivo dal sito ufficiale e leggi README.html.
pause
exit /b 1
:finished
if errorlevel 1 (
 echo Operazione non riuscita. Leggi README.html.
 pause
 exit /b 1
)
{'echo Apri Rewards Adviser, scegli il ruolo e premi Salva e collega.' if action == 'start' else 'echo Collegamento locale fermato.'}
'''.replace('\n', '\r\n')


def _personal_names(source):
    match = re.search(r'DEFAULT_NAMES\s*=\s*([\[(].*?[\])])', source)
    if not match:
        raise ValueError('Runtime account defaults are missing')
    values = ast.literal_eval(match.group(1))
    if len(values) != 3 or any(not isinstance(value, str) for value in values):
        raise ValueError('Runtime must define three account names')
    return values


def _public_panel(source):
    source, count = re.subn(r'<select id="profile"[^>]*>.*?</select>', PROFILE_OPTIONS, source, count=1, flags=re.S)
    if count != 1:
        raise ValueError('Profile selection is missing from the panel')
    source, count = re.subn(r'<select id="slot"[^>]*>.*?</select>', SLOT_OPTIONS, source, count=1, flags=re.S)
    if count != 1:
        raise ValueError('Reader slots are missing from the panel')
    source = source.replace('scegli il profilo usato in questa finestra', 'scegli il ruolo di questa finestra')
    source = source.replace('Email e impostazioni si compilano da sole.', 'La chiave si compila da sola; l’email è facoltativa e viene letta dalla pagina Rewards.')
    source = source.replace('Profilo di questa finestra', 'Ruolo di questa finestra')
    source = source.replace('Email Microsoft<input', 'Email Microsoft (facoltativa)<input')
    source = source.replace('Quella usata su Rewards', 'Lascia vuota per rilevarla da Rewards')
    source = source.replace('Coordinatore dei promemoria — attivalo solo in Edge', 'Coordinatore dei promemoria — attivalo in un solo profilo')
    return source


def _public_launcher(source):
    message = ("REWARDS ADVISER\n\nChiave locale personale:\n\n" + "{token}" +
               "\n\nQuesta chiave resta sul tuo PC. Non condividerla.\n\n"
               "1. Carica la cartella principale che contiene manifest.json in ciascun profilo del browser.\n"
               "2. Scegli Lettore 1, 2 o 3 per i tuoi account oppure Pannello.\n"
               "3. Salva e collega, quindi apri Rewards in ogni lettore.\n"
               "4. Lascia un solo coordinatore dei promemoria attivo.\n\nGuida: README.html\n")
    expression = repr(message).replace('{token}', "'+store.token+'")
    replacement = "pairing.write_text(" + expression + ",encoding='utf-8')"
    source, count = re.subn(r"pairing\.write_text\([^\n]+\)", lambda match: replacement, source, count=1)
    if count != 1:
        raise ValueError('Local pairing instructions are missing from the launcher')
    return source


def build_public_package(root: Path, destination: Path) -> Path:
    """Create a fresh public ZIP; preserve every file in the personal source root.

    The ZIP root is the unpacked extension root. A recipient runs AVVIA.cmd
    before installing it to generate that recipient's private pairing files.
    """
    root = Path(root).resolve()
    destination = Path(destination)
    payloads = {}
    for name in RUNTIME_FILES:
        source = root / name
        if not source.resolve().is_relative_to(root):
            raise ValueError('Runtime asset escapes the source directory: ' + name)
        if not source.is_file():
            raise FileNotFoundError(source)
        if destination.resolve() == source.resolve():
            raise ValueError('The destination cannot replace a runtime file')
        payloads[name] = source.read_bytes()

    texts = {name: data.decode('utf-8-sig') for name, data in payloads.items() if not name.endswith(('.png', '.jpg', '.jpeg'))}
    aliases = {}
    for name in ('extension/core.js', 'companion/server.py'):
        aliases.update({value: f'Account {slot}' for slot, value in enumerate(_personal_names(texts[name]), 1)})
    texts['extension/profiles.js'] = PUBLIC_PROFILES
    texts['extension/ui/index.html'] = _public_panel(texts['extension/ui/index.html'])
    texts['companion/launcher.py'] = _public_launcher(texts['companion/launcher.py'])
    for name, source in texts.items():
        for alias, generic in sorted(aliases.items(), key=lambda item: len(item[0]), reverse=True):
            source = source.replace(alias, generic)
        source = source.replace('Pannello Edge', 'Pannello')
        if name == 'extension/ui/demo.js':
            source = re.sub(r"email:'account[123]@example\.com'", "email:''", source)
        if name == 'extension/ui/ui.js':
            source = source.replace('Associazione azzerata. Inserisci la nuova email e salva.', 'Associazione azzerata. Salva e apri Rewards; puoi anche inserire l’email a mano.')
            source = source.replace('Attiva il coordinatore nell’estensione Edge.', 'Attiva il coordinatore in un solo profilo.')
        payloads[name] = source.encode('utf-8')
    payloads['AVVIA.cmd'] = _command('start').encode('utf-8')
    payloads['FERMA.cmd'] = _command('stop').encode('utf-8')
    payloads['README.html'] = README.encode('utf-8')

    # Fail before writing an archive if an allowed runtime file gained personal data.
    for name, data in payloads.items():
        if name.endswith(('.png', '.jpg', '.jpeg')):
            continue
        source = data.decode('utf-8')
        if re.search(r'[A-Za-z]:[\\/]Users[\\/]', source, flags=re.I):
            raise ValueError('Absolute user path in public runtime: ' + name)
        addresses = re.findall(r'[A-Za-z0-9_.+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', source)
        if any(not address.lower().endswith('@example.com') for address in addresses):
            raise ValueError('Personal email in public runtime: ' + name)

    # Validate the main manifest here so malformed input is never distributed.
    json.loads(payloads['manifest.json'])
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(prefix='rewards-public-', suffix='.zip', dir=destination.parent, delete=False) as temporary:
        pending = Path(temporary.name)
    try:
        with zipfile.ZipFile(pending, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
            for name, data in payloads.items():
                archive.writestr(name, data)
        pending.replace(destination)
    finally:
        pending.unlink(missing_ok=True)
    return destination
