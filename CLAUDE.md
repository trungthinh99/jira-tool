# Jira Report Tool — Hướng dẫn cho Claude Code

Tool cá nhân của một FE, không phải sản phẩm giao cho khách. Xem
[README.md](README.md) cho cách cài và chạy; file này là phần **nghiệp vụ và
quy ước** — đọc trước khi sửa bất cứ thứ gì.

## Nói chuyện với user

- **Luôn trả lời bằng tiếng Việt**, kể cả sau khi `/compact`.
- Gọi user là **"Bimo"**, tự xưng là **"tôi"**.

---

## 1. Nghiệp vụ: tool này thay thế việc gì

Bimo là FE, mỗi ngày phải làm hai việc thủ công mà tool này tự động hoá:

**Việc 1 — theo dõi task được phân.** Task tới từ ba nguồn khác nhau, và nguồn
quyết định cách xử lý:

| Nguồn | Hình dạng trên Jira | Nhận biết trong code |
| --- | --- | --- |
| **BE** (Jame) tách story thành sub-task | `Sub-task` có `parent` | `taskSource() === 'backend'` |
| **BA** (sney) gửi yêu cầu chỉnh sửa | `Improvement` | `taskSource() === 'ba'` |
| **Tester** báo lỗi | `Bug` | `taskSource() === 'tester'` |

Đây là **suy luận của FE**, Jira không có trường nào ghi "nguồn". Logic nằm ở
`frontend/src/utils.ts` → `taskSource()`. Sửa cách phân nhóm thì sửa ở đó.

**Việc 2 — báo cáo cuối ngày.** Mỗi tối Bimo post một comment tổng kết lên issue
báo cáo của từng dự án, mention BA/QA để họ nắm tiến độ. Trước đây gõ tay, giờ
tool thống kê sẵn rồi Bimo chỉ soát lại.

## 2. Hai dự án, hai đích báo cáo — không được trộn

Đây là ràng buộc nghiệp vụ quan trọng nhất. Một ngày làm việc thường đụng cả hai
dự án, nhưng **mỗi dự án báo cáo riêng, mention người riêng**:

| Dự án | Project key | Issue nhận báo cáo | Mention |
| --- | --- | --- | --- |
| Hwashin ERP | `HWE` | `PPP-354` | @Ruby @sney |
| TMS | `DT` | `PPP-308` | @Sumi @Ruby |

Post nhầm đích hoặc mention nhầm người là lỗi nghiệp vụ, không phải lỗi hiển
thị. Vì vậy ba thứ đó (project, issue, mention) khai báo **cùng một chỗ** trong
`backend/src/config.ts` → `REPORT_TARGETS`, chứ không phải ba bảng tra song song
có thể lệch nhau.

Thêm dự án mới = thêm một entry vào mảng đó. Frontend đọc từ `GET /api/targets`
nên không cần sửa gì bên FE.

### accountId đã biết

| Người | Vai trò | accountId |
| --- | --- | --- |
| MOBI (Bimo) | FE | `712020:3f2962d5-3b89-4885-985c-444b4cd4f5cc` |
| sney | BA / QA | `712020:d22b3123-52e3-46cb-b435-4b9a30fb166f` |
| Ruby | PM | `712020:cc414e81-af9e-4033-8159-e7ed19785489` |
| Sumi | TMS | `70121:5b5e92a5-862c-4edc-994f-c02ab8a3280f` |

## 3. Mẫu báo cáo — sao chép, đừng "sửa cho đẹp"

```
*Report 18/09/2026
Today task:
 • https://jakenm.atlassian.net/browse/HWE-425: 100%
Next task:
 • Ghép API theo điều chỉnh từ BA và BE
Issue: none
@Ruby @sney
```

Mẫu này lấy từ lịch sử comment có thật trên PPP-308 / PPP-354. Vài chi tiết
trông như lỗi nhưng **là chủ ý**:

- **`*Report` có dấu sao mở mà không có sao đóng.** Đó là mẫu nhà. Sửa cho cân
  đối sẽ làm báo cáo của Bimo khác với toàn bộ lịch sử phía trên.
- **Link là URL đầy đủ hiện nguyên văn**, không phải text `HWE-425` gắn link.
- **Nhãn `Today task:` / `Next task:` / `Issue:` in đậm**, nội dung thì không.
- Ngày định dạng `DD/MM/YYYY`.

Nếu Bimo bảo đổi mẫu, sửa `backend/src/jira/adf.ts` — cả `buildReportAdf()` và
`renderReportText()`, vì hai hàm phải luôn mô tả cùng một báo cáo.

### Quy ước phần trăm

`defaultPercent()` trong `frontend/src/utils.ts` suy từ trạng thái:

| Trạng thái | % | Vì sao |
| --- | --- | --- |
| Done, Review | 100 | Xong phần việc của FE |
| In Progress | 70 | Con số quy ước sẵn trong lịch sử báo cáo |
| Còn lại | 50 | Đoán an toàn |

Đây chỉ là **giá trị mặc định** — Bimo sửa tay được trên UI trước khi đăng.

## 4. Backend — nghiệp vụ và bẫy

`backend/` là Express + TypeScript, giữ token và là thứ duy nhất nói chuyện với
Jira.

- **Token chỉ sống ở backend.** Frontend gọi `/api/*`. Đây không phải sở thích
  kiến trúc: để token xuống browser là lộ nguyên quyền read-write toàn site
  trong bundle JS, và browser gọi thẳng `atlassian.net` thì vướng CORS. Thêm
  biến môi trường thì cập nhật luôn `.env.example`.

- **Comment phải gửi dạng ADF**, không phải markdown hay HTML. Mention cần node
  thật mang `accountId` thì Jira mới hiện tên và bắn thông báo; viết `@sney`
  dạng text thì chỉ là chữ thường. Tool MCP `addOrEditJiraIssueComment` với
  `contentFormat: html` **từ chối** `data-mention-id`, nên phải gọi thẳng
  `POST /rest/api/3/issue/{key}/comment`.

- **`status CHANGED DURING` bỏ sót task.** JQL thống kê trong ngày chỉ bắt task
  có đổi trạng thái. Task làm cả ngày mà chưa chuyển status sẽ **không** xuất
  hiện. Đây là đánh đổi có chủ ý — nới JQL ra `updated >=` sẽ kéo theo cả task
  chỉ được comment. Bù bằng ô "Thêm thủ công" trên UI. **Đừng tự nới JQL** mà
  chưa hỏi Bimo.

- **Transition tra theo tên trạng thái, không hardcode id.** Trên HWE hiện tại
  id là `11` To Do · `21` In Progress · `31` Done · `51` Review, nhưng id là cấu
  hình workflow và đổi được khi board bị sửa. `transitionIssue()` gọi
  `/transitions` lấy danh sách rồi khớp theo tên.

- **Phân trang JQL phải đi hết.** `searchAll()` lặp theo `nextPageToken`. Một
  ngày làm nhiều có thể vượt một trang, và danh sách bị cắt âm thầm = báo cáo
  thiếu task.

- **`parseReport.ts` đọc HTML, không đọc ADF.** Jira trả comment cũ dưới dạng
  HTML vì mention khiến markdown mất dữ liệu. Parse fail thì **không phải lỗi** —
  rơi về `defaultNextTasks` của target.

- **401/403 từ Jira được đổi thành 502.** Đó là token của tool hỏng, không phải
  user cần đăng nhập lại — trả 401 ra UI sẽ báo sai nguyên nhân.

## 5. Frontend — nghiệp vụ và quy ước

`frontend/` là Vite + React + Tailwind, proxy `/api` sang cổng 4180.

- **UI tiếng Việt.** Tool dùng riêng, không i18n. (Khác hẳn
  `hwashin-erp/frontend` nơi UI bắt buộc tiếng Hàn — đừng mang quy ước đó sang.)
- **Comment code tiếng Anh**, kể cả JSDoc. Chỉ comment WHY khi không hiển nhiên.
- **Không có state management library.** `useState` + `useEffect` là đủ cho hai
  màn hình; đừng thêm Redux/Zustand/React Query.
- **Luôn có bước preview trước khi ghi lên Jira.** Đăng báo cáo và chuyển trạng
  thái đều là hành động không hoàn tác được từ tool. Thêm hành động ghi mới thì
  giữ nguyên nguyên tắc này.
- **`ReportForm` được remount khi đổi ngày hoặc đổi tab** (qua `key`), để dòng
  thủ công của ngày này không dính sang ngày khác.
- Badge "mới" ở Inbox đọc snapshot `localStorage` lúc mount (`seenAtMount`), nên
  không bị chính lần refresh đó xoá mất.

## 6. Cấu trúc file

```
backend/
  src/config.ts        REPORT_TARGETS + accountId — thêm dự án ở đây
  src/jira/
    client.ts          fetch + gom lỗi Jira về một dạng
    adf.ts             dựng ADF comment + bản preview text (phải khớp nhau)
    parseReport.ts     đọc ngược "Next task" từ báo cáo cũ
    service.ts         JQL và nghiệp vụ
    types.ts
  src/routes.ts        REST cho frontend
  src/server.ts        middleware + error handler
frontend/
  src/api/             client + types
  src/pages/           InboxPage · ReportPage · ReportForm
  src/components/ui.tsx
  src/utils.ts         taskSource, defaultPercent, format ngày
```

## 7. Trước khi commit

- `npm run type-check` ở **cả hai** thư mục. Không có pre-commit hook.
- `npm run build` bên frontend nếu có đụng JSX.
- **Không commit `.env`.** Đã gitignore, nhưng kiểm lại `git status` vẫn tốt.
