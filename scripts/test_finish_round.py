import sys, json, time, random
import websocket

def main():
    if len(sys.argv) < 4:
        print("usage: test_finish_round.py <domain> <room_id> <round_id> [user_count]")
        sys.exit(1)
    domain = sys.argv[1]
    room_id = sys.argv[2]
    round_id = int(sys.argv[3])
    user_count = int(sys.argv[4]) if len(sys.argv) >= 5 else 4

    url = f"wss://{domain}/ws"
    ws = websocket.create_connection(url)
    ws.send(json.dumps({"type":"join","roomId":room_id}))
    ws.send(json.dumps({"type":"startRound","roundId":round_id,"startTime":int(time.time())}))

    # random group results and users
    outcome = random.choice(["RedWin","BlueWin","Tie"])
    if outcome == "RedWin":
        group_results = [{"groupId":"Red","result":1},{"groupId":"Blue","result":2}]
    elif outcome == "BlueWin":
        group_results = [{"groupId":"Blue","result":1},{"groupId":"Red","result":2}]
    else:
        group_results = [{"groupId":"Red","result":3},{"groupId":"Blue","result":3}]

    users = []
    for i in range(user_count):
        gid = random.choice(["Red","Blue"])
        win = (outcome == "Tie") and False or ((outcome == "RedWin" and gid == "Red") or (outcome == "BlueWin" and gid == "Blue"))
        users.append({"openId": f"user_{int(time.time())}_{i}", "addPoints": random.randint(1, 15), "isWin": win, "groupId": gid})

    payload = {"type":"finishRound","roomId":room_id,"roundId":round_id,"groupResults":group_results,"users":users}
    ws.send(json.dumps(payload))
    start = time.time()
    while time.time() - start < 10:
        try:
            ws.settimeout(2)
            msg = ws.recv()
            print(msg)
        except websocket.WebSocketTimeoutException:
            pass
    ws.close()

if __name__ == "__main__":
    main()