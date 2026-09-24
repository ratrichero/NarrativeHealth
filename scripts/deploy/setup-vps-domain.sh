#!/usr/bin/env bash
# SQ-DEPLOY: setup VPS để app chạy qua https://coins.run.place
#
# Sử dụng (chạy TRÊN VPS, với root/sudo):
#   sudo bash setup-vps-domain.sh "email@cua-ban@example.com"
#
# Script làm gì (idempotent — chạy lại an toàn):
#   1. Cài nginx + certbot (Let's Encrypt) + iptables-persistent.
#   2. Tạo site nginx reverse-proxy: 80/443 (domain) -> 127.0.0.1:3000 (Next.js).
#   3. Mở cổng 80/443 trong iptables của máy (image Oracle Ubuntu mặc định khóa).
#   4. Cấp chứng chỉ TLS và tự động redirect HTTP -> HTTPS.
#
# LƯU Ý QUAN TRỌNG (lớp firewall thứ 2 của Oracle Cloud):
#   Ngoài iptables, phải mở cổng trong Oracle Console:
#   Networking -> Virtual Cloud Networks -> VCN của bạn -> Security Lists
#   -> Add Ingress Rule: Source CIDR 0.0.0.0/0, IP Protocol TCP,
#      Destination Port Range 80  (lặp lại cho 443).

set -euo pipefail

DOMAIN="coins.run.place"
APP_PORT=3000
EMAIL="${1:-}"

if [[ $EUID -ne 0 ]]; then
  echo "Chạy với root/sudo: sudo bash $0 \"email@cua-ban@example.com\""
  exit 1
fi

if [[ -z "$EMAIL" ]]; then
  read -rp "Email cho Let's Encrypt (nhận thông báo gia hạn): " EMAIL
fi

echo "==> [1/4] Cài nginx, certbot, iptables-persistent..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y nginx certbot python3-certbot-nginx iptables-persistent

echo "==> [2/4] Tạo site nginx: ${DOMAIN} -> 127.0.0.1:${APP_PORT}..."
# Heredoc KHÔNG quoted: ${DOMAIN}/${APP_PORT} được bash thay; các biến
# nginx ($host, $http_upgrade...) phải escape bằng \$ để bash giữ nguyên.
cat > "/etc/nginx/sites-available/${DOMAIN}" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN} www.${DOMAIN};

    location / {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 90s;
        proxy_buffering off;
        client_max_body_size 10m;
    }
}
EOF

ln -sf "/etc/nginx/sites-available/${DOMAIN}" "/etc/nginx/sites-enabled/${DOMAIN}"
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo "==> [3/4] Mở cổng 80/443 trong iptables (lớp firewall trong máy)..."
iptables -C INPUT -p tcp --dport 80  -j ACCEPT 2>/dev/null || iptables -I INPUT -p tcp --dport 80  -j ACCEPT
iptables -C INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || iptables -I INPUT -p tcp --dport 443 -j ACCEPT
netfilter-persistent save

echo "==> [4/4] Cấp chứng chỉ TLS (Let's Encrypt) + bật redirect HTTPS..."
certbot --nginx -d "${DOMAIN}" -d www."${DOMAIN}" \
  --non-interactive --agree-tos -m "${EMAIL}" --redirect

echo
echo "✅ Xong. Kiểm tra: https://${DOMAIN}"
echo "   - Certbot tự gia hạn (systemd timer 'certbot.timer')."
echo "   - Nếu trang không mở được mà script không báo lỗi, gần như chắc chắn"
echo "     còn thiếu Ingress Rule 80/443 trong Oracle Cloud Security List."
