import sys, json, time
import websocket

def main():
    if len(sys.argv) < 4:
        print("usage: test_live.py <domain> <token> <round>")
        sys.exit(1)
    domain = sys.argv[1]
    token = sys.argv[2]
    round_id = int(sys.argv[3])
    url = f"wss://{domain}/ws"
    ws = websocket.create_connection(url)
    ws.send(json.dumps({"type":"ping"}))
    ws.send(json.dumps({"type":"join","token":token}))
    ws.send(json.dumps({"type":"startgame","msgTypes":["live_comment","live_gift","live_like","live_fansclub"]}))
    ws.send(json.dumps({"type":"startRound","roundId":round_id,"startTime":int(time.time())}))
    start = time.time()
    while time.time() - start < 180:
        try:
            ws.settimeout(5)
            msg = ws.recv()
            print(msg)
        except websocket.WebSocketTimeoutException:
            pass
        ws.send(json.dumps({"type":"ping"}))
        time.sleep(30)
    ws.close()

if __name__ == "__main__":
    main()