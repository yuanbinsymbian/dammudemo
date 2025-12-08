import sys, json, time
import websocket

def parse_participants(arg):
    res = []
    if not arg:
        return res
    # format: openId,points,isWin;openId2,points2,isWin2
    parts = arg.split(";")
    for p in parts:
        p = p.strip()
        if not p:
            continue
        items = p.split(",")
        if len(items) < 3:
            continue
        oid = items[0].strip()
        pts = int(items[1].strip())
        win = items[2].strip().lower() in ("1","true","yes","y")
        res.append({"openId": oid, "deltaPoints": pts, "isWin": win})
    return res

def main():
    if len(sys.argv) < 5:
        print("usage: test_finish_round.py <domain> <room_id> <round_id> <winner(Red|Blue|Draw)> [participants]")
        print("participants format: openId,points,isWin;openId2,points2,isWin2")
        sys.exit(1)
    domain = sys.argv[1]
    room_id = sys.argv[2]
    round_id = int(sys.argv[3])
    winner = sys.argv[4]
    participants_arg = sys.argv[5] if len(sys.argv) >= 6 else ""
    participants = parse_participants(participants_arg)

    url = f"wss://{domain}/ws"
    ws = websocket.create_connection(url)
    ws.send(json.dumps({"type":"join","roomId":room_id}))
    # optional startRound for completeness
    ws.send(json.dumps({"type":"startRound","roundId":round_id,"startTime":int(time.time())}))
    payload = {"type":"finishRound","roomId":room_id,"roundId":round_id,"winner":winner,"users":participants}
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