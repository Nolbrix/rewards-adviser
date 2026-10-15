"""Generate Chromium catalogs and the preview fallback from one translation file."""
import hashlib,json
from pathlib import Path

def build(root):
    root=Path(root)
    sources=json.loads((root/'extension/translations.json').read_text(encoding='utf-8'))
    entries={source:{'id':'m'+hashlib.sha256(source.encode()).hexdigest()[:16],'en':english} for source,english in sources.items()}
    content="(function(root,data){if(typeof module==='object'&&module.exports)module.exports=data;else root.RewardsStrings=data;})(globalThis,"+json.dumps(entries,ensure_ascii=False,separators=(',',':'))+");\n"
    (root/'extension/strings.js').write_text(content,encoding='utf-8')
    for locale in ('it','en'):
        catalog={entry['id']:{'message':source if locale=='it' else entry['en'],'description':source} for source,entry in entries.items()}
        catalog['extensionName']={'message':'Rewards Adviser'}
        catalog['extensionDescription']={'message':'Fino a tre account Rewards: progressi, telefono e promemoria locali.' if locale=='it' else 'Up to three Rewards accounts: progress, phone points and local reminders.'}
        for folder in (root/'_locales',root/'extension/_locales'):
            target=folder/locale/'messages.json';target.parent.mkdir(parents=True,exist_ok=True);target.write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

if __name__=='__main__':build(Path(__file__).resolve().parents[1])
