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

**Bẫy: thứ tự kiểm tra trong `taskSource()` là bắt buộc.** Improvement cũng có
`parent` (trỏ tới Epic, vd HWE-482 → HWE-4 "Master Data"), nên phải xét
`issuetype` **trước** rồi mới xét `parentKey`. Đảo lại là mọi Improvement bị
gom nhầm vào "Sub-task từ BE". Đã xác minh trên dữ liệu thật: Improvement do
sney tạo, sub-task `FE_YYMMDD:` do Jame tạo.

**Việc 2 — báo cáo cuối ngày.** Mỗi tối Bimo post một comment tổng kết lên issue
báo cáo của từng dự án, mention BA/QA để họ nắm tiến độ. Trước đây gõ tay, giờ
tool thống kê sẵn rồi Bimo chỉ soát lại.

**Việc 3 — chuyển trạng thái theo quy trình bàn giao.** Xem mục 1b.

## 1b. Quy trình làm task của FE — vòng đời một Story

Đây là nghiệp vụ đứng sau menu **Thao tác**. Hiểu nó thì mới hiểu vì sao màn đó
gom task theo Story và cho chuyển trạng thái hàng loạt.

Một vòng đời đầy đủ:

1. **BA (sney)** mô tả yêu cầu vào phần *description* của Story, phần cập nhật
   mới bôi **màu đỏ**.
2. **BE (Jame)** đọc description rồi tạo sub-task cho cả hai phía, đặt tiêu đề
   theo ngày cập nhật của Story:
   - `BE_YYMMDD: ...` — phần việc của BE
   - `FE_YYMMDD: ...` — phần việc của Bimo
   `YYMMDD` là **ngày Story được cập nhật**, không phải ngày tạo sub-task.
3. **BE** chuyển task của mình `In Progress` → làm xong → `Review`.
4. **FE (Bimo)** thấy task BE sang `Review` thì vào kiểm tra đã có docs/API chạy
   được chưa. Nếu được:
   - chuyển **task của BE** sang `Done` (FE là người xác nhận, không phải BE),
   - chuyển **task của mình** sang `In Progress` rồi bắt đầu làm.
5. **FE** làm xong → chuyển task mình sang `Review` → **tạo sub-task cho QA**
   tiêu đề `QA_YYMMDD: Test giao diện và chức năng ...`, trạng thái `To Do`,
   assign cho BA.
6. **BA** test. Pass thì tự chuyển `Done` cho **cả task QA lẫn task FE**.

Hệ quả cho code — ba điều dễ làm sai:

- **FE chuyển trạng thái task của người khác.** Bước 4 nghĩa là Bimo đổi status
  task do Jame làm. Nên màn Thao tác **không lọc theo `assignee`** như menu
  Thông báo; nó lấy mọi sub-task của Story. Đây là chủ ý, không phải bug.
- **Nhận diện task theo prefix tiêu đề, không theo assignee.** Dữ liệu thật:
  HWE-486 có 5 sub-task `FE_260921 (ALL):` và 3 sub-task `BE_260921:`. Phần sau
  prefix khác nhau (`(ALL):`, `:`) nên phải khớp bằng regex, xem `taskRole()`
  trong `frontend/src/utils.ts`.
- **Task QA có hai mẫu tiêu đề.** Mẫu cũ `[QA] Test giao diện và chức năng màn
  hình` (HWE-191…HWE-280), mẫu mới `QA_YYMMDD: ...` (từ HWE-485). Khi **tạo**
  thì dùng mẫu mới; khi **nhận diện** phải bắt cả hai, nếu không task QA cũ sẽ
  bị đếm nhầm thành chưa tạo.

Improvement (vd HWE-482) đi tắt: không có sub-task FE/BE, Bimo làm thẳng rồi tạo
QA sub-task ngay dưới nó. Vì vậy màn Thao tác cho tạo QA trực tiếp trên
Improvement/Bug.

QA sub-task mẫu — HWE-485 dưới HWE-482: `issuetype: Sub-task`, `parent` là chính
Improvement đó, `assignee: sney`, `reporter: MOBI`, trạng thái tạo ra là `To Do`.

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

| Người | accountId | Ghi chú |
| --- | --- | --- |
| MOBI (Bimo) | `712020:3f2962d5-3b89-4885-985c-444b4cd4f5cc` | FE — chủ tool |
| sney | `712020:d22b3123-52e3-46cb-b435-4b9a30fb166f` | BA/QA — mention ở báo cáo HWE |
| Ruby | `712020:cc414e81-af9e-4033-8159-e7ed19785489` | mention ở **cả hai** báo cáo |
| Sumi | `70121:5b5e92a5-862c-4edc-994f-c02ab8a3280f` | mention ở báo cáo TMS |

(Vai trò cụ thể của Ruby và Sumi chưa được xác nhận — bảng này chỉ ghi chắc
chắn ai được mention ở đâu, theo lịch sử comment thật. Jame là BE, tạo các
sub-task `FE_YYMMDD:`.)

### Custom field trên site này

Chưa dùng tới, ghi lại để khỏi dò lại (id custom field khác nhau theo từng site):

| Field | id | Giá trị mẫu |
| --- | --- | --- |
| Sprint | `customfield_10020` | `HWE Sprint 5` |
| Tech Area | `customfield_10205` | `FE` |
| Path/URL | `customfield_10340` | link màn hình trên staging |
| Epic Link | `customfield_10014` | `HWE-4` |
| Story Points | `customfield_10015` là Start date — **không** phải story point | |

MCP mặc định trả `view: compact` và **bỏ hết custom field**. Muốn thấy phải
truyền `view: 'evidence'`; giá trị nằm ở `fields.customFields`, không phải
`customfield_*` ở cấp trên cùng.

## 3. Mẫu báo cáo — sao chép, đừng "sửa cho đẹp"

```
*Report 18/09/2026
Today task:
 • Thay đổi thứ tự hiện thị row trong drawer kho 창고: 100%
Next task:
 • Ghép API theo điều chỉnh từ BA và BE
Issue: none
@Ruby @sney
```

Mẫu này lấy từ lịch sử comment có thật trên PPP-308 / PPP-354. Vài chi tiết
trông như lỗi nhưng **là chủ ý**:

- **`*Report` có dấu sao mở mà không có sao đóng.** Đó là mẫu nhà. Sửa cho cân
  đối sẽ làm báo cáo của Bimo khác với toàn bộ lịch sử phía trên.
- **Nhãn `Today task:` / `Next task:` / `Issue:` in đậm**, nội dung thì không.
- Ngày định dạng `DD/MM/YYYY`.

**Dòng task là tiêu đề có gắn link, không phải URL trần.** Lịch sử cũ hiện URL
đầy đủ; Bimo đổi ngày 21/09/2026 vì một danh sách tiêu đề dễ đọc hơn một danh
sách URL. ADF vẫn giữ `href` trỏ tới issue, chỉ đổi phần text hiển thị. Dòng
"Thêm thủ công" không có tiêu đề nên rơi về hiển thị key.

Bản preview text **không** dựng được link, nên nó in tiêu đề rồi thêm dòng
`↳ <url>` bên dưới — để Bimo soát được link sẽ gửi đi, chứ không phải duyệt một
thứ mình không nhìn thấy.

Nếu Bimo bảo đổi mẫu, sửa `backend/src/jira/adf.ts` — cả `buildReportAdf()` và
`renderReportText()`, vì hai hàm phải luôn mô tả cùng một báo cáo.

### Báo Slack sau khi đăng

Đăng báo cáo xong thì bắn một tin nhắn vào Slack (`em báo cáo rồi nha chị`) để
chị khỏi phải tự vào Jira xem. Cấu hình ở `backend/.env`:

| Biến | Ý nghĩa |
| --- | --- |
| `SLACK_USER_TOKEN` | User OAuth Token (`xoxp-...`), scope `chat:write` — **cái nên dùng** |
| `SLACK_BOT_TOKEN` | Bot token (`xoxb-...`), chỉ là phương án dự phòng |
| `SLACK_REPORT_CHANNEL` | Channel ID dạng `C...` — hiện là `#dev-team` (`C09MJAZT1CL`) |
| `SLACK_REPORT_MESSAGE` | Nội dung tin nhắn, đổi được mà không phải sửa code |

**Gửi bằng user token, không phải bot.** Bimo muốn tin nhắn là *mình* báo cáo,
không phải một con bot nhắn hộ — bot thì Slack gắn nhãn `APP` cạnh tên và hiện
avatar app. Vì vậy `config.slack.token` ưu tiên `SLACK_USER_TOKEN` rồi mới rơi
về `SLACK_BOT_TOKEN`, và payload luôn kèm `as_user: true` (bot token bỏ qua
field này nên một đường code chạy được cả hai).

Đổi lại: user token mang **quyền tài khoản Slack của Bimo**, không phải quyền
một app riêng. Giữ nó như token Jira — chỉ ở `backend/.env`, không xuống
browser, không commit.

Ba điều đã cân nhắc, đừng "sửa cho gọn":

- **Thiếu token thì bỏ qua lặng lẽ**, không lỗi. Tool vốn chạy được không cần
  Slack; bắt buộc có token sẽ làm hỏng máy chưa cấu hình.
- **Slack lỗi KHÔNG làm hỏng việc đăng báo cáo.** Comment Jira đã post thì
  không rút lại được — trả lỗi cho cả thao tác sẽ khiến Bimo bấm đăng lại và
  sinh comment trùng trên PPP-354/PPP-308. Vì vậy `postReport()` trả thêm
  `slack: { sent, skipped, error }` và UI hiện cảnh báo riêng kèm nút
  **"Gửi lại Slack"**, gọi `POST /api/slack/ping` — gửi mỗi tin nhắn, không
  đụng Jira.
- **Slack trả HTTP 200 kể cả khi từ chối**, lý do nằm ở `ok: false` + `error`.
  Chỉ xem status code là tưởng gửi thành công. `backend/src/slack/client.ts`
  dịch sẵn bốn mã hay gặp lúc cài (`not_in_channel`, `channel_not_found`,
  `invalid_auth`, `missing_scope`) sang tiếng Việt kèm cách xử lý.

Bẫy cài đặt: `chat:write` phải nằm ở **User Token Scopes**, không phải Bot Token
Scopes — thêm nhầm chỗ thì vẫn ra `xoxb-` chứ không ra `xoxp-`. Thêm scope xong
**phải Reinstall app** thì token mới có hiệu lực. Và tài khoản gửi phải là thành
viên của kênh, nếu không Slack trả `not_in_channel`.

Hiện cả hai dự án dùng chung một kênh. Muốn tách kênh theo dự án thì thêm field
vào `REPORT_TARGETS` (mục 2) chứ đừng đẻ bảng tra song song.

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

- **`status CHANGED DURING` bỏ sót task.** JQL thống kê trong ngày (menu Báo
  cáo) chỉ bắt task có đổi trạng thái. Task làm cả ngày mà chưa chuyển status sẽ
  **không** xuất hiện. Đây là đánh đổi có chủ ý — nới JQL ra `updated >=` sẽ kéo
  theo cả task chỉ được comment. Bù bằng ô "Thêm thủ công" trên UI. **Đừng tự
  nới JQL này** mà chưa hỏi Bimo.

- **JQL của Inbox đã được nới ngày 21/09/2026**, khi thêm filter status và
  người làm. Trước: `assignee = currentUser() AND status = "To Do"`. Sau:
  `project IN (...) AND assignee = currentUser() AND statusCategory != Done`,
  cộng thêm sub-task anh em qua `fetchChildren()`. Lọc thật nằm ở FE
  (`matchesFilters` trong `InboxPage`), mặc định vẫn là To Do + người dùng hiện
  tại nên màn hình mở ra giống hệt trước.

  **Phải giới hạn `project IN (...)`.** Bỏ ra thì JQL kéo về chính hai issue báo
  cáo PPP-354 / PPP-308 — chúng assign cho Bimo và nằm ở In Progress vĩnh viễn —
  cùng các project lạ (SPB, PPP khác). Đã gặp thật khi kiểm thử.

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
  src/slack/
    client.ts          chat.postMessage + dịch mã lỗi Slack sang tiếng Việt
  src/routes.ts        REST cho frontend
  src/server.ts        middleware + error handler
frontend/
  src/api/             client + types
  src/pages/           InboxPage · ActionsPage · ReportPage · ReportForm
                       MentionPicker · CreateQaDialog
  src/components/ui.tsx
  src/utils.ts         taskSource, taskRole, defaultPercent, format ngày
```

## 7. Trước khi commit

- `npm run type-check` ở **cả hai** thư mục. Không có pre-commit hook.
- `npm run build` bên frontend nếu có đụng JSX.
- **Không commit `.env`.** Đã gitignore, nhưng kiểm lại `git status` vẫn tốt.

---

## 8. Môi trường và thông tin sẵn có

**Site Jira**: `jakenm.atlassian.net`
**cloudId**: `edd86293-4d11-4839-b762-9a53b31126d7` — MCP Atlassian nhận thẳng
chuỗi `jakenm.atlassian.net` làm `cloudId` nên thường không cần UUID này.

**Token** nằm ở `backend/.env`, lấy từ `D:\Note\jira-tools\.jira-token.dpapi`
(mã hoá DPAPI, chỉ giải được bằng chính user Windows này, trên chính máy này).
Token thuộc tài khoản **`trungthinh.1799@gmail.com`** — KHÔNG phải email đăng
nhập của phiên Claude. Dùng sai email sẽ bị 404 trông như "không tìm thấy
issue" chứ không báo lỗi xác thực.

Giải mã lại khi cần:

```powershell
$sec = Get-Content "D:\Note\jira-tools\.jira-token.dpapi" | ConvertTo-SecureString
$tok = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
         [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
```

**Cổng**: backend `4180`, frontend `5180`. Chọn tránh xa các dự án khác của
Bimo (HWE ERP dùng 5174, TMS 5173).

**Git**: remote `origin` trỏ
<https://github.com/trungthinh99/jira-tool>, nhánh `main`. Push không cần nhập
gì — Windows Credential Manager đã có sẵn credential. `gh` CLI **chưa cài**,
đừng gọi.

### Thư mục liên quan

| Đường dẫn | Nội dung |
| --- | --- |
| `D:\Note\jira-tools\` | Script PowerShell upload ảnh lên Jira + đổi attachment id sang media UUID. Đọc README ở đó nếu cần đính ảnh vào comment. |
| `D:\hwashin-erp\` | Dự án ERP riêng, **không liên quan** tới tool này. Quy ước bên đó (UI tiếng Hàn, Tailwind token riêng) không áp dụng ở đây. |
| `D:\hwashin-erp\docs\jira-story-handoff.md` | Quy trình bàn giao một story: chụp ảnh kết quả → comment kèm ảnh → chuyển Review → tạo task QA. **Khác việc mà tool này làm** (báo cáo hàng ngày), nhưng cùng một hệ Jira và cùng các accountId. Đọc khi Bimo nhắc tới bàn giao story hoặc dán link Jira story. |

## 9. Trạng thái hiện tại — cái gì đã chạy thật, cái gì chưa

Tính tới **21/09/2026**, tool đã dựng xong và chạy với dữ liệu Jira thật.

**Đã kiểm chứng bằng dữ liệu thật:**

| Hạng mục | Kết quả |
| --- | --- |
| Menu Thông báo | 4 task To Do thật (HWE-474/476/478/480), nhóm đúng "Sub-task từ BE" |
| Thống kê ngày 21/09 | 3 task HWE Done → tự điền 100% |
| Thống kê ngày 18/09, tab TMS | 9 task DT, mention tự đổi `@Sumi @Ruby`, đích sang PPP-308 |
| Tách project | 20 HWE / 9 DT, không lẫn |
| Prefill "Next task" | Đọc ngược từ comment gần nhất, đúng cho cả hai dự án |
| Preview | Khớp mẫu nhà, tiếng Việt không lỗi font |
| type-check + build | Sạch cả hai phía |

**CHƯA chạy thật — cần Bimo bấm thử:**

- **Nút "Đăng báo cáo"** — sẽ post comment thật lên PPP-354 / PPP-308, và
  (nếu đã cấu hình) nhắn Slack.
- **Gửi Slack** — chưa chạy lần nào vì chưa có `SLACK_BOT_TOKEN`. Thử riêng
  được bằng `POST /api/slack/ping` mà không đụng gì tới Jira.
- **Nút "Bắt đầu"** ở Inbox — sẽ đổi trạng thái task thật sang In Progress.
- **Menu Thao tác** — nút "Chuyển N task" đổi trạng thái hàng loạt, nút "+ QA"
  tạo sub-task thật. Phần đọc (`GET /targets/:id/handover`) đã kiểm trên dữ
  liệu thật: 27 task chưa xong, gom đúng 5 Story, phân đúng 14 FE / 12 BE.

Cả hai đều ghi lên Jira nên tôi không tự chạy. Code đã xong; nếu ADF có gì lệch
mẫu thì sửa `adf.ts`. **Khi kiểm thử, đừng post thử lên PPP-354/PPP-308** — đó
là issue báo cáo thật mà BA và PM đang đọc. Tạo issue nháp riêng để thử.

### Nguyên tắc: không tự ý ghi lên Jira

Việc đọc (JQL, đọc comment) thì thoải mái. Việc **ghi** — post comment, đổi
trạng thái, tạo issue — phải hỏi Bimo trước, kể cả khi đang sửa code và muốn
kiểm chứng. Jira này là nơi làm việc thật của cả team, không phải môi trường
thử.

## 10. Hướng phát triển đã bàn nhưng chưa làm

Bimo chưa yêu cầu, ghi lại để khỏi bàn lại từ đầu:

- **Tự động đăng báo cáo theo giờ** — backend đã tách riêng nên thêm cron được;
  nhưng bản chất tool là "Bimo soát rồi mới đăng", tự động hoàn toàn sẽ mất
  bước đó.
- **Deploy lên server** — hiện chạy local hai terminal. Muốn deploy thì phải
  tính lại chỗ giữ token.
- **Đính ảnh vào báo cáo** — script sẵn ở `D:\Note\jira-tools\`, chưa nối vào
  tool.
- **Nới JQL thống kê** — xem mục 4, đã cân nhắc và cố ý không làm.
