import sys, json, time, random
import websocket

def ws_send(ws, obj):
    ws.send(json.dumps(obj))

def post_json(url, body, headers):
    data = json.dumps(body, ensure_ascii=False).encode('utf-8')
    req = request.Request(url, data=data, headers=headers, method='POST')
    with request.urlopen(req) as resp:
        return resp.read().decode('utf-8')

def parse_participants(arg):
    res = []
    if not arg:
        return res
    parts = arg.split(';')
    for p in parts:
        p = p.strip()
        if not p:
            continue
        items = p.split(',')
        if len(items) < 3:
            continue
        oid = items[0].strip()
        pts = int(items[1].strip())
        win = items[2].strip().lower() in ('1','true','yes','y')
        res.append({'openId': oid, 'addPoints': pts, 'isWin': win})
    return res

def main():
    if len(sys.argv) < 4:
        print('usage: test_e2e_round.py <domain> (--roomId <room_id> | --token <token>) <round_id> [user_count]')
        sys.exit(1)
    domain = sys.argv[1]
    token = None
    room_id = None
    idx = 2
    mode = sys.argv[idx]
    if mode == '--token':
        token = sys.argv[idx+1]
        round_id = int(sys.argv[idx+2])
        user_count = int(sys.argv[idx+3]) if len(sys.argv) >= idx+4 else 4
    elif mode == '--roomId':
        room_id = sys.argv[idx+1]
        round_id = int(sys.argv[idx+2])
        user_count = int(sys.argv[idx+3]) if len(sys.argv) >= idx+4 else 4
    else:
        room_id = sys.argv[2]
        round_id = int(sys.argv[3])
        user_count = int(sys.argv[4]) if len(sys.argv) >= 5 else 4

    ws = websocket.create_connection(f'wss://{domain}/ws')
    if token:
        ws_send(ws, {'type':'join','token':token})
    else:
        ws_send(ws, {'type':'join','roomId':room_id})
    ws_send(ws, {'type':'startRound','roundId':round_id,'startTime':int(time.time())})

    outcome = random.choice(['RedWin','BlueWin','Tie'])
    if outcome == 'RedWin':
        group_results = [{'groupId':'Red','result':1},{'groupId':'Blue','result':2}]
    elif outcome == 'BlueWin':
        group_results = [{'groupId':'Blue','result':1},{'groupId':'Red','result':2}]
    else:
        group_results = [{'groupId':'Red','result':3},{'groupId':'Blue','result':3}]

    users = []
    for i in range(user_count):
        gid = random.choice(['Red','Blue'])
        win = (outcome == 'Tie') and False or ((outcome == 'RedWin' and gid == 'Red') or (outcome == 'BlueWin' and gid == 'Blue'))
        users.append({'openId': f'user_{int(time.time())}_{i}', 'addPoints': random.randint(1, 15), 'isWin': win, 'groupId': gid})

    payload = {'type':'finishRound','groupResults':group_results,'users':users}
    if room_id:
        payload['roomId'] = room_id
    payload['roundId'] = round_id
    ws_send(ws, payload)
    print('payload:', json.dumps(payload, ensure_ascii=False))
    ok = False
    start = time.time()
    while True:
        try:
            ws.settimeout(3)
            msg = ws.recv()
            print(msg)
            try:
                obj = json.loads(msg)
                if obj.get('type') == 'finishRound_ok':
                    ok = True
            except Exception:
                pass
        except websocket.WebSocketTimeoutException:
            pass
        ws_send(ws, {'type':'ping'})
        time.sleep(30)

if __name__ == '__main__':
    main()