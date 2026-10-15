import json,os
from pathlib import Path
import sys
runtime_root=Path(sys.argv[2]) if len(sys.argv)>2 else Path(__file__).parents[1]
sys.path.insert(0,str(runtime_root/'companion'))
from server import make_server
server=make_server(port=int(os.environ.get('REWARDS_TEST_RELAY_PORT','18744')),state_dir=Path(sys.argv[1]),extension_dir=runtime_root/'extension')
print(json.dumps({'token':server.store.token}),flush=True)
try:server.serve_forever()
finally:server.server_close()
