import sys, json, time, random, hashlib, base64
import websocket
from urllib import request

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
        res.append({'openId': oid, 'deltaPoints': pts, 'isWin': win})
    return res

def main():
    if len(sys.argv) < 7:
        print('usage: test_e2e_round.py <domain> <room_id> <round_id> <winner(Red|Blue|Draw)> <comment_open_id_left> <comment_open_id_right> [participants]')
        print('participants format: openId,points,isWin;openId2,points2,isWin2')
        sys.exit(1)
    domain = sys.argv[1]
    room_id = sys.argv[2]
    round_id = int(sys.argv[3])
    winner = sys.argv[4]
    c_left = sys.argv[5]
    c_right = sys.argv[6]
    participants_arg = sys.argv[7] if len(sys.argv) >= 8 else ''
    participants = parse_participants(participants_arg)

    ws = websocket.create_connection(f'wss://{domain}/ws')
    ws_send(ws, {'type':'join','roomId':room_id})
    ws_send(ws, {'type':'startRound','roundId':round_id,'startTime':int(time.time())})

    # simulate live comment callbacks to assign groups
    cb_url = f'https://{domain}/live_data_callback'
    print(post_json(cb_url, {'room_id':room_id,'user_open_id':c_left,'content':'左'}, {'content-type':'application/json','x-msg-type':'live_comment','x-roomid':room_id}))
    print(post_json(cb_url, {'room_id':room_id,'user_open_id':c_right,'content':'右'}, {'content-type':'application/json','x-msg-type':'live_comment','x-roomid':room_id}))

    # finish round and upload results
    ws_send(ws, {'type':'finishRound','roomId':room_id,'roundId':round_id,'winner':winner,'users':participants})

    start = time.time()
    while time.time() - start < 15:
        try:
            ws.settimeout(2)
            msg = ws.recv()
            print(msg)
        except websocket.WebSocketTimeoutException:
            pass
        time.sleep(1)
    ws.close()

if __name__ == '__main__':
    main()