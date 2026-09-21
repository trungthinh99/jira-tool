# Jira Report Tool — Hướng dẫn cho Claude Code

Tool cá nhân, không phải sản phẩm giao cho khách. Xem [README.md](README.md) cho
mục đích và cách chạy.

## Nói chuyện với user

- **Luôn trả lời bằng tiếng Việt**, kể cả sau khi `/compact`.
- Gọi user là **"Bimo"**, tự xưng là **"tôi"**.

## Ngôn ngữ trong code

- **UI tiếng Việt** — đây là tool dùng riêng, không có i18n và không cần tiếng Hàn.
  (Khác với `hwashin-erp/frontend`, nơi UI bắt buộc tiếng Hàn.)
- **Comment code tiếng Anh**, kể cả JSDoc.
- Chỉ comment WHY khi không hiển nhiên. Không comment WHAT.

## Cấu trúc

```
backend/          Express + TS, giữ token, nói chuyện với Jira
  src/config.ts   REPORT_TARGETS — thêm dự án mới ở đây
  src/jira/
    client.ts     fetch + gom lỗi Jira về một dạng
    adf.ts        dựng ADF comment + bản preview text
    parseReport.ts đọc ngược "Next task" từ báo cáo cũ
    service.ts    JQL và nghiệp vụ
  src/routes.ts   REST cho frontend
frontend/         Vite + React + Tailwind, proxy /api sang :4180
  src/api/        client + types
  src/pages/      InboxPage, ReportPage, ReportForm
  src/components/ui.tsx
```

## Quy tắc

- **Token chỉ sống ở backend.** Frontend gọi `/api/*`, không bao giờ gọi thẳng
  `atlassian.net`. Thêm biến môi trường thì cập nhật luôn `.env.example`.
- **Comment Jira phải là ADF**, không phải markdown/HTML — mention cần node thật
  mang `accountId`. `addOrEditJiraIssueComment` với `contentFormat: html` từ chối
  `data-mention-id`, nên dùng REST thẳng.
- **`adf.ts` giữ cả hai bản dựng** (ADF và text preview) cạnh nhau, vì preview là
  thứ user duyệt trước khi đăng — tách ra hai nơi là hai bản báo cáo khác nhau.
- **Transition tra theo tên trạng thái**, không hardcode id.
- Thêm dự án báo cáo = thêm một entry vào `REPORT_TARGETS`. Frontend tự đọc, không
  cần sửa.
- Chạy `npm run type-check` ở cả hai thư mục trước khi commit. Không có pre-commit hook.
