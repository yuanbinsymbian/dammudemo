import sys, json
from urllib import request

def main():
    if len(sys.argv) < 4:
        print("usage: test_live_callback_comment.py <domain> <room_id> <open_id> [text]")
        sys.exit(1)
    domain = sys.argv[1]
    room_id = sys.argv[2]
    open_id = sys.argv[3]
    text = sys.argv[4] if len(sys.argv) >= 5 else "左"
    url = f"https://{domain}/live_data_callback"
    body = json.dumps({"room_id": room_id, "user_open_id": open_id, "content": text}).encode("utf-8")
    headers = {"content-type":"application/json","x-msg-type":"live_comment","x-roomid":room_id}
    req = request.Request(url, data=body, headers=headers, method="POST")
    with request.urlopen(req) as resp:
        print(resp.read().decode("utf-8"))

if __name__ == "__main__":
    main()