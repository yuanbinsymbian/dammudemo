import sys, json, time, random, hashlib, base64
from urllib import request

def sign(headers, body_str, secret):
    keys = sorted(headers.keys())
    url_params = "&".join([f"{k}={headers[k]}" for k in keys])
    raw = (url_params + body_str + secret).encode("utf-8")
    md5 = hashlib.md5(raw).digest()
    return base64.b64encode(md5).decode("utf-8")

def call_query(domain, app_id, room_id, open_id, secret):
    url = f"https://{domain}/api/user_group/query"
    body = {"app_id": app_id, "open_id": open_id, "room_id": room_id}
    body_str = json.dumps(body, ensure_ascii=False)
    headers = {
        "content-type": "application/json",
        "x-nonce-str": str(random.randint(100000,999999)),
        "x-timestamp": str(int(time.time()*1000)),
        "x-roomid": room_id,
        "x-msg-type": "user_group",
    }
    if secret:
        headers["x-signature"] = sign({k: headers[k] for k in ["x-msg-type","x-nonce-str","x-roomid","x-timestamp"]}, body_str, secret)
    req = request.Request(url, data=body_str.encode("utf-8"), headers=headers, method="POST")
    with request.urlopen(req) as resp:
        return resp.read().decode("utf-8")

def main():
    if len(sys.argv) < 6:
        print("usage: test_e2e_round_verify.py <domain> <app_id> <room_id> <open_id_left> <open_id_right> [secret]")
        sys.exit(1)
    domain, app_id, room_id, left, right = sys.argv[1:6]
    secret = sys.argv[6] if len(sys.argv) >= 7 else ""
    print(call_query(domain, app_id, room_id, left, secret))
    print(call_query(domain, app_id, room_id, right, secret))

if __name__ == "__main__":
    main()