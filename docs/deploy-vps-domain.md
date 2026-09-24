# Deploy lên VPS với domain coins.run.place

App Next.js chạy trên VPS tại `127.0.0.1:3000` (IP công khai `168.138.179.192`).
Tài liệu này cấu hình Nginx + HTTPS để truy cập qua `https://coins.run.place`.

## Kiến trúc

```
Browser ──https──▶ Nginx (80/443) ──http──▶ Next.js (127.0.0.1:3000)
                    │
                    └── Let's Encrypt cert (certbot tự gia hạn)
```

Domain đã trỏ đúng DNS:
- A record: `coins.run.place` → `168.138.179.192`
- CNAME: `www` → `coins.run.place`

## 1. Chạy script setup trên VPS

Copy script vào VPS và chạy:

```bash
scp scripts/deploy/setup-vps-domain.sh user@168.138.179.192:/tmp/
ssh user@168.138.179.192
sudo bash /tmp/setup-vps-domain.sh "your-email@example.com"
```

Script làm 4 việc (idempotent — chạy lại an toàn):
1. Cài `nginx`, `certbot`, `iptables-persistent`.
2. Tạo site reverse-proxy `80/443 → 127.0.0.1:3000`.
3. Mở cổng 80/443 trong iptables của máy.
4. Cấp chứng chỉ TLS và bật redirect HTTP→HTTPS.

## 2. ⚠️ Mở cổng trong Oracle Cloud (bắt buộc)

IP `168.138.*` là Oracle Cloud — có **2 lớp firewall**. Script chỉ mở lớp
trong máy (iptables). Lớp ngoài phải mở thủ công trên Console:

> Networking → Virtual Cloud Networks → VCN của bạn → Security Lists
> → **Add Ingress Rule** (làm 2 lần cho 80 và 443):
> - Source CIDR: `0.0.0.0/0`
> - IP Protocol: `TCP`
> - Destination Port Range: `80` (rồi `443`)

## 3. Chạy app bằng PM2 (đang dùng)

PM2 quản lý tiến trình thay systemd. Checklist cho VPS:

```bash
# App phải chạy ở chế độ production, fork mode (KHÔNG dùng cluster mode):
pm2 delete narrativehealth 2>/dev/null || true
NODE_ENV=production PORT=3000 pm2 start npm --name narrativehealth -- run start
pm2 save

# Tự khởi động cùng máy (chạy lệnh nó in ra rồi dán lại nếu được yêu cầu):
pm2 startup systemd
```

Lưu ý quan trọng:
- **Chỉ chạy 1 instance, fork mode** (`pm2 start npm ...`, không `pm2 start -i max`):
  scheduler/cron đăng bài Square chạy trong tiến trình app — cluster mode sẽ
  khiến nhiều instance đăng bài trùng lặp.
- Build production trước khi start: `npm run build`.
- `pm2 save` + `pm2 startup` là bắt buộc để app sống lại sau reboot VPS.
- Kiểm tra: `pm2 list` (status online), `pm2 logs narrativehealth`.

## 4. Kiểm tra

```bash
curl -I https://coins.run.place          # 200/307 từ Next.js
curl -I http://coins.run.place           # 301 → https
sudo systemctl status nginx certbot.timer
pm2 list                                 # app online
sudo certbot renew --dry-run             # test gia hạn cert
```

### Nếu trang không mở được

| Triệu chứng | Nguyên nhân thường gặp |
|---|---|
| curl timeout từ ngoài | Thiếu Ingress Rule 80/443 trong Oracle Security List (bước 2) |
| `502 Bad Gateway` | App chưa chạy: `pm2 list` + `pm2 logs narrativehealth`, kiểm tra cổng 3000 |
| Certbot fail "no valid A record" | DNS chưa lan truyền — chờ TTL 8h của bản ghi hiện tại |
| HTTPS hoạt động, HTTP không | Certbot --redirect chưa chạy lại: `sudo certbot --nginx -d coins.run.place -d www.coins.run.place --redirect` |

## Cập nhật app (deploy lần sau)

```bash
cd /path/to/NarrativeHealth
git pull
npm ci && npm run build
pm2 restart narrativehealth
```
