# Jira Report Tool

Màn hình admin cá nhân để tự động hoá quy trình báo cáo Jira hàng ngày của FE.

Hai việc nó làm:

1. **Thông báo** — liệt kê task được phân cho mình mà còn ở trạng thái `To Do`,
   nhóm theo nguồn (sub-task từ BE / improvement từ BA / bug từ Tester).
2. **Báo cáo** — thống kê task đã đổi trạng thái trong ngày, dựng sẵn nội dung
   báo cáo theo đúng mẫu nhà, rồi đăng thẳng thành comment lên issue báo cáo.

## Kiến trúc

```
browser ──/api──> frontend (Vite :5180) ──proxy──> backend (:4180) ──> Jira Cloud REST v3
```

Backend giữ Jira API token và là nơi duy nhất nói chuyện với Jira. Token không
bao giờ xuống browser, và browser cũng không gọi thẳng `atlassian.net` nên
không vướng CORS.

## Chạy

Cần hai terminal.

```bash
# 1. backend
cd backend
cp .env.example .env     # rồi điền JIRA_EMAIL + JIRA_API_TOKEN
npm install
npm run dev              # http://localhost:4180

# 2. frontend
cd frontend
npm install
npm run dev              # http://localhost:5180
```

Tạo API token tại <https://id.atlassian.com/manage-profile/security/api-tokens>.

## Cấu hình đích báo cáo

Mỗi dự án được theo dõi khai báo trong `backend/src/config.ts` →
`REPORT_TARGETS`. Một entry gồm: project key, issue nhận comment báo cáo,
danh sách người được mention, và các dòng "Next task" mặc định.

| Dự án | Project | Đăng báo cáo vào | Mention |
| --- | --- | --- | --- |
| Hwashin ERP | `HWE` | `PPP-354` | @Ruby @sney |
| TMS | `DT` | `PPP-308` | @Sumi @Ruby |

Thêm dự án mới = thêm một entry vào mảng đó, không cần đụng frontend — UI đọc
danh sách tab từ `GET /api/targets`.

## Mẫu báo cáo

Khớp đúng định dạng đang dùng trên PPP-308 / PPP-354:

```
*Report 18/09/2026
Today task:
 • https://jakenm.atlassian.net/browse/HWE-425: 100%
 • https://jakenm.atlassian.net/browse/HWE-426: 100%
Next task:
 • Ghép API theo điều chỉnh từ BA và BE
 • Fix bug (nếu có)
Issue: none
@Ruby @sney
```

Dấu `*` ở đầu `*Report` không có dấu đóng — đó là mẫu nhà, giữ nguyên cho đồng
bộ với lịch sử báo cáo.

Comment được gửi dưới dạng **ADF** chứ không phải markdown hay HTML: mention
phải là node thật mang `accountId` thì Jira mới hiện đúng tên và gửi thông báo.

## API

| Method | Path | Việc |
| --- | --- | --- |
| GET | `/api/health` | Kiểm tra backend + site |
| GET | `/api/targets` | Danh sách đích báo cáo cho UI |
| GET | `/api/inbox` | Task `To Do` được phân cho mình |
| GET | `/api/activity?date=YYYY-MM-DD` | Task đổi trạng thái trong ngày |
| GET | `/api/targets/:id/previous-next-tasks` | "Next task" của báo cáo gần nhất |
| POST | `/api/targets/:id/preview` | Dựng nội dung, chưa đăng |
| POST | `/api/targets/:id/report` | Đăng comment báo cáo |
| GET | `/api/issues/:key/transitions` | Các transition khả dụng |
| POST | `/api/issues/:key/transition` | Chuyển trạng thái (theo tên, không theo id) |

## Ghi chú

- **Thống kê dựa trên `status CHANGED`**, nên task làm cả ngày mà chưa đổi
  trạng thái sẽ không xuất hiện. Dùng ô "Thêm thủ công" để bổ sung.
- **Transition tra theo tên trạng thái**, không hardcode id — id là cấu hình
  workflow và có thể đổi khi board được sửa.
- `.env` nằm trong `.gitignore`. Đừng commit token.
