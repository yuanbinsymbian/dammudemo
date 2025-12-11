import sys, json, time, random
import websocket

def ws_send(ws, obj):
    ws.send(json.dumps(obj))

def random_group_results():
    outcome = random.choice(['RedWin','BlueWin','Tie'])
    if outcome == 'RedWin':
        return outcome, [{'groupId':'Red','result':1},{'groupId':'Blue','result':2}]
    elif outcome == 'BlueWin':
        return outcome, [{'groupId':'Blue','result':1},{'groupId':'Red','result':2}]
    else:
        return outcome, [{'groupId':'Red','result':3},{'groupId':'Blue','result':3}]

def random_users(user_count, outcome):
    users = []
    for i in range(user_count):
        gid = random.choice(['Red','Blue'])
        win = (outcome == 'Tie') and False or ((outcome == 'RedWin' and gid == 'Red') or (outcome == 'BlueWin' and gid == 'Blue'))
        users.append({'openId': f'user_{int(time.time())}_{i}', 'addPoints': random.randint(1, 15), 'isWin': win, 'groupId': gid})
    return users

red_set = set()
blue_set = set()

def update_from_message(msg):
    try:
        obj = json.loads(msg)
    except Exception:
        return
    t = obj.get('type')
    if t == 'group_push':
        gid = obj.get('group_id') or (obj.get('data') or {}).get('group_id')
        oid = obj.get('open_id') or (obj.get('data') or {}).get('open_id')
        if gid and oid:
            if str(gid) == 'Red':
                blue_set.discard(oid)
                red_set.add(oid)
            elif str(gid) == 'Blue':
                red_set.discard(oid)
                blue_set.add(oid)
    elif t == 'live_data':
        gid = obj.get('group_id')
        oid = obj.get('open_id')
        if gid and oid:
            if str(gid) == 'Red':
                blue_set.discard(oid)
                red_set.add(oid)
            elif str(gid) == 'Blue':
                red_set.discard(oid)
                blue_set.add(oid)

def recv_loop(ws, duration_sec=10):
    deadline = time.time() + duration_sec
    while time.time() < deadline:
        try:
            ws.settimeout(3)
            msg = ws.recv()
            print(msg)
            update_from_message(msg)
        except websocket.WebSocketTimeoutException:
            pass

def main():
    if len(sys.argv) < 4:
        print('usage: test_e2e_token_flow.py <domain> <token> <round_id> [user_count] [wait_secs] [post_wait_secs]')
        sys.exit(1)
    domain = sys.argv[1]
    token = sys.argv[2]
    round_id = int(sys.argv[3])
    def to_int_or(default, val):
        try:
            if val is None:
                return default
            s = str(val).strip()
            if s == '':
                return default
            return int(s)
        except Exception:
            return default
    user_count = to_int_or(6, sys.argv[4] if len(sys.argv) >= 5 else None)
    wait_secs = to_int_or(120, sys.argv[5] if len(sys.argv) >= 6 else None)
    post_wait_secs = to_int_or(10, sys.argv[6] if len(sys.argv) >= 7 else None)

    ws = websocket.create_connection(f'wss://{domain}/ws')
    ws_send(ws, {'type':'join','token':token})
    joined_room_id = None
    t0 = time.time()
    while time.time() - t0 < 15:
        try:
            ws.settimeout(3)
            msg = ws.recv()
            print(msg)
            try:
                obj = json.loads(msg)
                if obj.get('type') == 'joined':
                    joined_room_id = obj.get('roomId') or obj.get('roomIdStr') or obj.get('room_id') or obj.get('room_id_str')
                    print('joined room:', joined_room_id)
                    break
                elif obj.get('type') == 'join_failed':
                    print('join_failed:', json.dumps(obj, ensure_ascii=False))
                    ws.close()
                    sys.exit(3)
            except Exception:
                pass
        except websocket.WebSocketTimeoutException:
            pass

    if not joined_room_id:
        print('join not confirmed within timeout')
        ws.close()
        sys.exit(4)

    ws_send(ws, {'type':'startgame', 'msgTypes': ['live_comment','live_gift','live_like'], 'roomId': joined_room_id})
    print('sent startgame')

    current_round = round_id
    ws_send(ws, {'type':'startRound','roundId':current_round,'startTime':int(time.time())})
    print('start round', current_round)

    while True:
        end = time.time() + wait_secs
        while time.time() < end:
            try:
                ws.settimeout(3)
                msg = ws.recv()
                print(msg)
                update_from_message(msg)
            except websocket.WebSocketTimeoutException:
                pass
            ws_send(ws, {'type':'ping'})
            time.sleep(5)

        win_side = random.choice(['Red','Blue'])
        if win_side == 'Red':
            group_results = [{'groupId':'Red','result':1},{'groupId':'Blue','result':2}]
            winners = list(red_set)
            losers = list(blue_set)
        else:
            group_results = [{'groupId':'Blue','result':1},{'groupId':'Red','result':2}]
            winners = list(blue_set)
            losers = list(red_set)

        selected_winners = winners[:user_count] if winners else []
        selected_losers = losers[:max(0, user_count - len(selected_winners))] if losers else []
        users = []
        for oid in selected_winners:
            users.append({'openId': oid, 'addPoints': 10, 'isWin': True, 'groupId': win_side})
        for oid in selected_losers:
            # addPoints 为 0，失败方
            users.append({'openId': oid, 'addPoints': 0, 'isWin': False, 'groupId': 'Red' if win_side=='Blue' else 'Blue'})

        if not users:
            outcome, group_results_random = random_group_results()
            users = random_users(user_count, outcome)
            group_results = group_results_random

        payload = {'type':'finishRound','groupResults':group_results,'users':users,'roundId':current_round}
        ws_send(ws, payload)
        print('finish payload:', json.dumps(payload, ensure_ascii=False))

        recv_loop(ws, post_wait_secs)

        current_round += 1
        ws_send(ws, {'type':'startRound','roundId':current_round,'startTime':int(time.time())})
        print('start round', current_round)
        recv_loop(ws, 5)

    ws.close()

if __name__ == '__main__':
    main()