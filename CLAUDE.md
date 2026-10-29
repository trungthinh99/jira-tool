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
- **Mỗi dự án viết prefix hơi khác nhau.** SR dùng `FE_260923 (All)` — chữ
  `All` viết hoa khác HWE `(ALL)` — và còn nhiều task mẫu cũ `[FE] Cắt giao
  diện ...` không có stamp. `taskRole()` và `stampFromSummary()` đã kiểm trên
  cả hai, nhưng thêm dự án mới thì kiểm lại bằng tiêu đề thật trước đã.
- **`YYMMDD` của task QA là ngày của vòng bàn giao, KHÔNG phải ngày bấm nút.**
  Đây là bug đã gặp thật: bấm `+ QA` sáng 22/09 cho story update 21/09 thì ra
  `QA_260922` trong khi task FE là `FE_260921` — một vòng bàn giao không tồn
  tại. `qaStamp()` trong `frontend/src/utils.ts` đọc stamp từ **tiêu đề các
  sub-task anh em** (lấy vòng mới nhất nếu story bàn giao nhiều lần), dự phòng
  là hôm nay.

  Đã xác minh trên board thật: cả 7 story đều chỉ có **một** stamp duy nhất
  xuyên suốt sub-task của nó, và ba task QA Bimo tạo tay trước đây (HWE-507,
  HWE-508, HWE-517) đều khớp stamp với task FE cùng story — tức chính Bimo cũng
  lấy ngày theo cách này.

  Bẫy regex: `FE_260921 (ALL): [BE_260820] Bổ sung...` (HWE-493) có **hai**
  stamp trong tiêu đề. Phải neo `^` để lấy `260921` của prefix, không phải
  `260820` của phần tham chiếu. Story không sub-task nào theo mẫu (HWE-328 trên
  board thật) thì rơi về hôm nay — dialog nói rõ để Bimo biết mà sửa tay.

  Dự phòng lý tưởng hơn là `updated` của Story, nhưng Jira **không** trả field
  đó trong `parent.fields` — lấy được thì tốn một request mỗi story, để phủ
  đúng trường hợp vốn chẳng có vòng bàn giao nào để khớp.
- **Nhãn "chưa có QA" so theo vòng, không phải "có QA hay chưa".**
  `needsQa()` trong `frontend/src/utils.ts`. Trên board thật, HWE-291 và
  HWE-303 đều **đã có** task QA (`QA_260827`, đã Done) nhưng vòng hiện tại là
  `260921` nên vẫn phải báo thiếu; HWE-34 có `[QA]` không stamp cũng vậy. Chỉ
  kiểm sự tồn tại thì bỏ sót cả ba.

  Task QA **không** stamp chỉ được tính khi cả nhóm cũng không có stamp nào —
  tức vòng đó có trước khi quy ước `YYMMDD` ra đời.

  Vì nhãn phải biết cả QA **đã Done**, `fetchHandoverBoard()` gọi thêm
  `fetchDoneQaChildren()`. Chỉ QA được lấy lại; FE/BE đã xong vẫn ẩn, nếu không
  board sẽ ngập task cũ.

  Nhưng những QA cũ đó **chỉ để tính nhãn, không hiện ra** —
  `withoutStaleQa()` lọc chúng trước khi render. Chúng là lịch sử, không phải
  việc đang làm. QA của **vòng hiện tại** mà đã Done thì vẫn hiện, vì biết BA
  đã test pass là thông tin có ích.

  **Bẫy đi kèm, nguy hiểm hơn cả hiển thị:** các nút "Chọn nhanh" (Task BE /
  Task FE / Task QA / Tất cả) từng chọn trên danh sách đầy đủ, nên sẽ tick cả
  QA cũ đang bị ẩn rồi "Chuyển N task" đổi trạng thái một task không ai thấy
  trên màn hình. Mọi thao tác chọn và số đếm giờ dùng `visible` trong
  `ActionsPage` — thêm thao tác ghi mới thì phải dùng danh sách đó, đừng dùng
  `issues`.

  Nút QA của **từng story** chỉ hiện khi story đó còn QA đang hiện, vì `roles`
  tính từ `withoutStaleQa(story.items)`. Nhờ vậy nó không bao giờ tick trúng QA
  cũ đã Done đang bị ẩn — chính cái bẫy ở trên.

  **Hai nút "Improvement" và "Bug" tách riêng, đừng gộp lại.** Bug chạy
  workflow khác (`TO FIX → FIXING`), nên tick lẫn hai loại thì dropdown rút
  còn `Review`/`Done` — đo thật: Improvement 8 task ra đủ 4 trạng thái, Bug ra
  `TO FIX / FIXING / Review / Done`, "Tất cả" 17 task chỉ còn 2. Gộp một nút
  là vĩnh viễn rơi vào trường hợp cuối, mất `TO FIX` và `FIXING`.

  **Chọn theo `taskSource()` trên `standalone`, KHÔNG theo
  `taskRole() === 'other'`.** Hai thứ này hiện trùng nhau trên cả ba board (đã
  tra: chỉ HWE-756 là role `other`, và nó đúng là Improvement), nhưng là hai
  câu hỏi khác nhau. Sub-task BE/FE tiêu đề mẫu cũ không prefix (`[FE] Cắt
  giao diện ...`, còn sống trên SR) cũng đọc ra role `other` — tick task của
  Jame bằng nút mang tên "Improvement" rồi chuyển trạng thái hàng loạt là đúng
  kiểu ghi nhầm màn này phải tránh.

  Mỗi nút ẩn khi board không có loại đó: SportsRab ẩn cả hai, HWE và TMS hiện
  mỗi nút Improvement (chưa board nào có Bug lúc kiểm — nhánh Bug đo bằng cách
  chèn một Bug giả vào payload `handover`, chỉ đọc).

### Gợi ý tiêu đề QA bằng AI của Jira

Bấm `+ QA` trên một **Improvement/Bug** thì tool hỏi AI của Jira (chính cái
chạy sau nút "Suggest" ở mục Subtasks) để lấy tiêu đề, rồi mới mở dialog.

```
POST /gateway/api/assist/api/ai/v2/ai-feature/jira/workbreakdown
X-Experience-Id: issue-work-breakdown      ← thiếu là 400
X-Product: jira-software
body: {"ai_feature_input":{"issueKey":"DT-1264"}}
```

**Endpoint NỘI BỘ, không có tài liệu.** Atlassian không công bố API nào cho
tính năng này: không có trong REST v3, không có trong danh sách tool của Rovo
MCP, và chính ticket AI-8 "APIs for Atlassian Intelligence" của họ (mở
12/2023, 136 vote) tới nay vẫn "Gathering Interest". Endpoint trên đọc được
từ network của browser ngày 16/10/2026. Nó đổi hoặc biến mất lúc nào cũng
được — **mọi lỗi phải rơi êm về tiêu đề mặc định**, đừng bao giờ để nó chặn
nút `+ QA`.

**May mắn lớn: nó nhận chính API token trong `backend/.env`.** Không cần
browser, cookie, Playwright hay scrape DOM. Gọi thẳng từ backend như mọi
endpoint Jira khác.

Đo thật trên 12 Improvement — kết quả **không ổn định**, thiết kế phải chịu
được điều đó:

| Kết quả | Số lần |
| --- | --- |
| Có gợi ý QA dùng được | 4/12 |
| Chỉ gợi ý việc dev | 4/12 |
| Không gợi ý gì | 4/12 |

- **6–10 giây mỗi lần.** Bimo chọn chờ AI rồi mới mở dialog, nên nút đổi nhãn
  thành "Đang hỏi AI…" và khoá lại trong lúc chờ.
- **Cùng một issue, hai lần ra hai tiêu đề khác nhau.** Đừng cache rồi tưởng
  sai; nó vốn vậy.
- **Không theo mẫu nhà.** Ra đủ kiểu `QA_Kiểm tra...`, `QA: Kiểm tra...`,
  `[APP] QA kiểm tra...`, thiếu stamp. `stripPrefixes()` trong `suggest.ts`
  bóc sạch rồi `seedTitle()` dựng lại thành `QA_YYMMDD: Test <nội dung>`.
- **Dialog hiện nguyên văn câu AI trả về** ở dòng "AI gợi ý:" — tiêu đề là bản
  diễn đạt lại, nên phải cho Bimo đối chiếu được với bản gốc.

**Chỉ hỏi AI cho Improvement/Bug, KHÔNG hỏi cho Story.** Description của Story
chồng nhiều khối `[Update N]` qua nhiều tháng, AI tóm nhầm vòng cũ; mà
sub-task của Story vốn đã mang sẵn chữ để đặt tên. Đã đo: Story mở dialog
trong 108ms, 0 lần gọi AI.

**Vì sao không tự dựng tiêu đề từ summary?** Đã thử và đo: công thức "bỏ
`[BO]` + ghép *Test giao diện*" chỉ khớp **7/92** task QA trong lịch sử. Lý do
là tiêu đề QA thật mô tả *thay đổi cụ thể*, còn summary của parent chỉ là *tên
màn hình* — thông tin đó nằm ở description.

### Assignee mặc định là reporter — chỉ là mặc định

`fetchReporter()` lấy người tạo Improvement làm assignee mặc định cho task QA.
**Đừng khoá cứng**: đo 8 cặp QA↔parent gần nhất trên DT, Bimo giữ reporter 4
lần và chọn người khác (Sumi, Luca) 4 lần. Dropdown vẫn đổi tự do.

Bẫy: `users` là danh sách assignable trên **issue báo cáo PPP**, không đảm bảo
chứa reporter của issue đang mở. Dialog tự chèn thêm một `<option>` cho
reporter khi thiếu, nếu không select sẽ âm thầm rơi về "không giao cho ai"
trong khi nhãn vẫn ghi tên người đó.

### Badge đầu dòng: role trước, work type sau

`rowBadge()` trong `utils.ts`. Sub-task hiện **vai bàn giao** (BE/FE/QA) vì đó
mới là thông tin có ích — type của chúng luôn là "Sub-task". Dòng nào không
đọc ra vai (Improvement, Bug) thì hiện **work type của Jira** thay vì `—`:
trên Jira Bimo thấy mũi tên xanh "Improvement", mà tool lại hiện gạch ngang.

**Không tốn request nào.** `issueType` đã nằm sẵn trong `ISSUE_FIELDS`, Jira
trả về cùng payload JQL.

**In thẳng tên Jira trả về, đừng map qua danh sách cứng.** Site này có nhiều
type hơn menu "Change work type": đã tra `/rest/api/3/issuetype` ra Bug, Epic,
Improvement, Meeting, New Feature, Research, Story, Task, Sub-task/Subtask,
cộng bản tiếng Hàn `에픽` và `하위 작업`. Type lạ phải đọc ra chính nó, không
rơi về `—`. `TYPE_TONE` chỉ tô màu vài loại hay gặp (Improvement xanh, Bug đỏ,
Story xanh lá, Epic vàng), còn lại trung tính — đã kiểm với `Research` và
`하위 작업`.

### Tạo QA xong thì nhãn phải tắt ngay

Bẫy index trễ (mục 4) áp cho **cả lệnh tạo**, không chỉ transition. Tạo QA
xong gọi `load()` thì JQL chưa thấy sub-task mới, nên nhãn "chưa có QA" vẫn
bám trên story/improvement vừa tạo — Bimo báo đúng lỗi này.

Chữa cùng một kiểu với `justMoved` / `justAssigned`: `load()` nhận thêm
`justCreated` và **chèn** issue mới vào danh sách nếu lần fetch đó chưa thấy
nó. Tin được vì `createSubtask()` đọc lại issue bằng `GET /issue/{key}` —
không qua search index. `onCreated` cũng `setIssues` ngay trước khi gọi
`load()`, để nhãn tắt lúc bấm chứ không phải một request sau.

Đo thật (giả POST, `handover` cố tình trả danh sách cũ): nhãn tắt sau 150ms và
**vẫn tắt** sau khi fetch cũ về.

**Sub-task của Improvement/Bug giờ có render.** Trước đây `standaloneKids` chỉ
dùng để tính nhãn, không in ra dòng nào — nên tạo QA cho một Improvement xong
thì task mới biến mất khỏi màn hình, nhìn như nút không ăn. Giờ chúng hiện
thụt vào dưới chính Improvement đó.

Kèm theo, **`visible` phải gồm cả các dòng con này** — đúng cái bẫy ở trên,
chỉ ngược chiều: render ra mà không cho vào `visible` thì "Tất cả" đếm một
đằng, màn hình hiện một nẻo. Đã đo: 15 dòng hiện / "Tất cả" tick 15 / badge
15, "Task QA" tick đúng 7 QA.

Số ở tiêu đề `Improvement / Bug · N` vẫn đếm riêng Improvement/Bug, không đếm
QA con — tiêu đề gọi tên thứ mà section liệt kê.

**Improvement/Bug có sub-task thì gập được**, dùng chung `collapsed` với story
(key chính là key của issue). `renderRow` nhận `opts.fold` để vẽ mũi tên.

- **Cột mũi tên có ở MỌI dòng**, chỗ nào không gập được thì là `<span>` rỗng
  cùng bề rộng. Thiếu nó thì checkbox lệch cột, và có lúc dòng con còn nằm
  trái hơn dòng cha — ngược hệ phân cấp. Đã đo: cha 530px, con 546px, và
  sub-task của story cũng 546px nên hai loại con cùng một cột.
- **`foldable` quyết định nút "Mở hết"/"Thu hết"**, gồm story + Improvement
  **có con**. Improvement không con mà tính vào thì `allCollapsed` không bao
  giờ true, nhãn kẹt ở "Thu hết" vĩnh viễn. Nút cũng đổi điều kiện hiện từ
  `storyGroups.length > 1` sang `foldable.length > 1` — board TMS toàn
  Improvement nên trước đây không có nút.
- **Improvement KHÔNG gập sẵn lúc mở board**, khác story. `foldedFor` phải lọc
  bỏ nhóm có parent là standalone, nếu không QA sub-task kéo Improvement vào
  `grouped.stories` và cả section mở ra đã đóng sạch. Lý do: story giấu cả
  chục dòng FE/BE, Improvement chỉ giấu một dòng QA.
- Gập rồi thì "Chọn nhanh" vẫn tick task đang ẩn — giống hệt story gập lâu
  nay, `visible` không xét `collapsed`. Gập là cho đỡ rối mắt, không phải để
  loại khỏi phạm vi thao tác.

### Nút copy tiêu đề

Mỗi dòng story và mỗi dòng sub-task có nút `⧉` ngay **sau tiêu đề** (component
`CopyTitle` trong `ActionsPage`), copy đúng phần tiêu đề — khác nút "Lấy link"
ở Inbox vốn copy URL. Mờ đi cho tới khi rê chuột vào dòng, để danh sách vẫn
đọc ra tiêu đề chứ không phải một cột nút.

Hai điều đã vấp phải, đừng làm lại:

- **Không lồng nút copy vào trong nút gập story.** Nested button là HTML sai,
  và bấm copy sẽ gập story luôn. Nó là anh em đứng ngay sau nút gập.
- **Nút gập story không được `flex-1`.** Để `flex-1` thì nút copy bị đẩy sang
  tận mép phải cạnh badge, không còn nằm cạnh tiêu đề. Nút gập co theo nội
  dung, một `<span className="flex-1" />` ăn hết chỗ trống thay nó.

### Giao việc hàng loạt

Cùng danh sách đã tick, nhưng là lệnh ghi khác: chọn người ở ô "Giao việc" rồi
bấm "Giao N task". Dùng chính `users` mà màn này đã tải sẵn cho dialog QA
(`GET /targets/:id/users`, tức `/user/assignable/search` trên issue báo cáo).

- **Gọi `PUT /issue/{key}/assignee`, không phải sửa field.** Endpoint riêng này
  chỉ đòi quyền "Assign issues"; sửa qua `fields.assignee` đòi thêm "Edit
  issues" mà FE không chắc có trên task của người khác.
- **`accountId: null` là "bỏ giao"**, khác hẳn "chưa chọn ai". Ô select dùng
  sentinel `'-'` cho Bỏ giao và `''` cho chưa chọn; route bắt buộc phải có
  field `accountId` (null cũng được) chứ không mặc định thành null, để một
  request thiếu field không âm thầm gỡ assignee của 13 task.
- **Cùng bẫy index trễ như transition.** Giao xong gọi lại `load()` thì Jira
  vẫn trả assignee cũ, nên `justAssigned` vá lại cột người giao y như
  `justMoved` vá status. Khác một điểm: giao việc **không** làm task rời board,
  nên chỉ ghi đè field chứ không loại dòng.
- **Banner kết quả dùng chung cho cả ba lệnh ghi** (chuyển / giao / tạo QA) nên
  nó mang theo `verb`. Trước đây tạo QA xong cũng báo "Chuyển xong 1/1 task".

Nút "Giao" bị khoá tới khi chọn cả task lẫn người — cả hai đều là ghi thật.

Improvement (vd HWE-482) đi tắt: không có sub-task FE/BE, Bimo làm thẳng rồi tạo
QA sub-task ngay dưới nó. Vì vậy màn Thao tác cho tạo QA trực tiếp trên
Improvement/Bug.

QA sub-task mẫu — HWE-485 dưới HWE-482: `issuetype: Sub-task`, `parent` là chính
Improvement đó, `assignee: sney`, `reporter: MOBI`, trạng thái tạo ra là `To Do`.

## 2. Ba dự án, ba đích báo cáo — không được trộn

Đây là ràng buộc nghiệp vụ quan trọng nhất. Một ngày làm việc thường đụng nhiều
dự án, nhưng **mỗi dự án báo cáo riêng, mention người riêng**:

| Dự án | Project key | Issue nhận báo cáo | Mention |
| --- | --- | --- | --- |
| Hwashin ERP | `HWE` | `PPP-341` | @Ruby @sney |
| TMS | `DT` | `PPP-226` | @Luca @Ruby |
| SportsRab | `SR` | `PPP-349` | @Ruby @Sumi @Minjun |

**Mention của TMS đổi ngày 19/10/2026:** Bimo bỏ Sumi, thay bằng Luca, và giữ
nguyên vị trí (Luca trước, Ruby sau). Chỉ đổi ở TMS — SportsRab vẫn mention
Sumi.

**Đích đã đổi ngày 28/09/2026.** Trước đó là `PPP-354` / `PPP-308` / `PPP-351`
— các **sub-task `[Web] - ... Report`** của riêng Bimo. Giờ chuyển lên chính
**task cha `[X] Prep for Dev`** (PPP-349 đúng là cha của PPP-351), nơi cả team
báo cáo chung: Perry (mobile), Jame (BE), Joseph cùng post vào đó.

Hệ quả quan trọng — xem mục 4, phần "đọc ngược báo cáo cũ": comment mới nhất
trên các issue này **thường không phải của Bimo**. PPP-226 có 100 comment gần
nhất không có cái nào của Bimo.

**Thứ tự mention của SR là Ruby trước, Sumi sau.** Lấy từ lịch sử comment thật
trên PPP-351, không suy từ target khác — đừng "sửa cho nhất quán".
**Minjun** do Bimo thêm ngày 23/09/2026, không có trong lịch sử comment cũ.

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
| Ruby | `712020:cc414e81-af9e-4033-8159-e7ed19785489` | mention ở **cả ba** báo cáo |
| Sumi | `70121:5b5e92a5-862c-4edc-994f-c02ab8a3280f` | mention ở báo cáo SportsRab (TMS tới 19/10/2026) |
| Minjun | `712020:9f629ab7-904b-49b4-95a8-a2aed75661a6` | mention ở báo cáo SportsRab |
| Luca | `712020:7aa99717-ae01-4697-9022-1277d79bfa9c` | mention ở báo cáo TMS từ 19/10/2026 |

`user/search?query=Luca` trả **rỗng** với token của tool, dù tài khoản đang
active. accountId của Luca được lấy từ assignee của các issue DT, rồi đối chiếu
lại bằng `GET /user?accountId=` và `user/viewissue/search` trên PPP-226 (Luca
xem được issue đó, nên mention sẽ bắn thông báo). Cần thêm người mới thì tra
theo cách này, đừng kết luận "không có user".

(Vai trò cụ thể của Ruby, Sumi và Luca chưa được xác nhận — bảng này chỉ ghi chắc
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

### Báo Slack — một tin cho cả ngày, không phải một tin mỗi dự án

Sau khi đăng báo cáo thì nhắn Slack (`em báo cáo rồi nha chị`) để chị khỏi phải
tự vào Jira xem.

**Nút Slack tách riêng khỏi nút "Đăng báo cáo".** Một ngày làm việc thường đụng
nhiều dự án, nên bấm đăng nhiều lần — nếu Slack gắn vào lệnh đăng thì kênh nhận
**mỗi dự án một** tin cho cùng một chuyện. Tin nhắn báo "hôm nay em đã báo cáo", không
phải "vừa post lên PPP-354". Vì vậy:

- `postReport()` **không** gọi Slack. Chỉ `POST /api/slack/ping` mới gửi.
- Nút **"Nhắn tin Slack"** (màu `danger`) nằm **ngay dưới nút "Đăng báo cáo"**
  trong cột phải của `ReportForm`, để trơn không box, và **luôn hiện** kể cả
  chưa đăng gì. Đã thử đặt ở cuối trang và ẩn cho tới khi đăng xong — cả hai
  đều hỏng: một ngày nhiều task đẩy nút xuống dưới hai màn hình cuộn, còn nút
  chỉ hiện sau khi đăng thì lúc đi tìm sẽ không thấy đâu.
- Nhắn xong mới hiện `✓ Đã nhắn Slack.` bên dưới. Nhãn nút cố định nên dòng
  này là thứ duy nhất ngăn bấm lần hai — đừng bỏ. Tab nào đã đăng thì có ✓.
- Nút **không bị khoá** khi chưa đăng — có hôm Bimo đăng tay trên Jira rồi chỉ
  cần nhắn.

**`ReportForm` bị remount khi đổi tab** (qua `key`), nên state Slack và "tab
này đã đăng" **phải** nằm ở `ReportPage` (`postedByTarget`, `slackPing`) rồi
truyền xuống qua prop `slack` — để trong form thì chuyển sang TMS là mất sạch
dấu vết đã đăng HWE. Đổi ngày thì xoá hết, vì đó là một ngày báo cáo mới.

Cấu hình ở `backend/.env`:

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
- **Slack lỗi KHÔNG ảnh hưởng gì tới báo cáo trên Jira.** Hai việc đã tách
  hẳn, nên `pingSlack()` trả `{ sent, skipped, error }` thay vì throw — lỗi
  hiện ngay trong khối Slack, bấm lại là gửi lại, không đụng gì tới comment đã
  post.
- **Slack trả HTTP 200 kể cả khi từ chối**, lý do nằm ở `ok: false` + `error`.
  Chỉ xem status code là tưởng gửi thành công. `backend/src/slack/client.ts`
  dịch sẵn bốn mã hay gặp lúc cài (`not_in_channel`, `channel_not_found`,
  `invalid_auth`, `missing_scope`) sang tiếng Việt kèm cách xử lý.

Bẫy cài đặt: `chat:write` phải nằm ở **User Token Scopes**, không phải Bot Token
Scopes — thêm nhầm chỗ thì vẫn ra `xoxb-` chứ không ra `xoxp-`. Thêm scope xong
**phải Reinstall app** thì token mới có hiệu lực. Và tài khoản gửi phải là thành
viên của kênh, nếu không Slack trả `not_in_channel`.

Hiện cả ba dự án dùng chung một kênh. Muốn tách kênh theo dự án thì thêm field
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

- **Backend chỉ nghe `127.0.0.1`, cố ý không cho cấu hình.** Tool không có
  đăng nhập, mọi lệnh ghi lên Jira/Slack đều mang tên Bimo. Trước 16/10/2026
  `app.listen(port)` nghe mọi interface, và Windows Firewall có sẵn rule cho
  `node.exe` trên profile Public — đo thật: `http://192.168.1.166:4180/api/targets`
  trả **200** từ IP LAN công ty, tức đồng nghiệp nào cũng `curl` được lệnh đăng
  báo cáo hay nhắn Slack. CORS không chặn được vì nó chỉ ràng buộc browser.
  Vite cũng ghim `host: 'localhost'` vì proxy `/api` của nó sẽ mở lại đúng lỗ
  này nếu ai đổi thành `true`. Proxy trỏ `127.0.0.1` chứ không `localhost` —
  `localhost` có thể ra `::1`, nơi backend không còn nghe.

- **Comment phải gửi dạng ADF**, không phải markdown hay HTML. Mention cần node
  thật mang `accountId` thì Jira mới hiện tên và bắn thông báo; viết `@sney`
  dạng text thì chỉ là chữ thường. Tool MCP `addOrEditJiraIssueComment` với
  `contentFormat: html` **từ chối** `data-mention-id`, nên phải gọi thẳng
  `POST /rest/api/3/issue/{key}/comment`.

- **Thống kê ngày lấy từ HAI nguồn.** `fetchDayActivity()` gộp:

  1. `status CHANGED DURING (...)` — task thật sự đổi trạng thái trong ngày.
  2. `status IN ("In Progress", "FIXING")` — task đang làm dở, **không giới
     hạn ngày**.

  Nguồn 2 thêm ngày 23/09/2026 vì nguồn 1 một mình thì bỏ sót đúng loại task
  tốn công nhất: một task làm ba ngày liền chỉ đổi status ở ngày cuối, nên hai
  ngày đầu báo cáo im lặng về nó. Bimo cần báo 70% → 80% → 90% trong khi status
  vẫn là In Progress suốt.

  Task thuộc nguồn 2 được đánh dấu `wip: true`, UI hiện nhãn **"đang làm"**.
  Task vừa đổi status hôm nay thì thuộc nguồn 1 (ưu tiên), không gắn `wip`.

  **Không** nới thành `updated >=` — nó kéo theo cả task chỉ bị comment hoặc
  sửa mô tả. Đã cân nhắc và cố ý không làm.

- **% của task đang làm dở đọc ngược từ báo cáo hôm trước.**
  `parseTaskPercents()` trong `parseReport.ts` bóc `key → %` từ comment gần
  nhất, và `ReportForm` dùng nó làm giá trị mặc định **chỉ cho dòng `wip`** —
  hôm qua báo 70% thì hôm nay mở ra 70% để Bimo sửa thành 80%, thay vì tụt về
  mặc định theo status. Dòng vừa Done hôm nay thì vẫn lấy `defaultPercent()`
  (100%), không đọc ngược.

  **Chỉ đọc comment của chính Bimo.** Từ 28/09/2026 đích báo cáo là task chung
  của cả team, nên comment mới nhất rất hay là của Perry hoặc Jame.
  `fetchLatestReportHtml()` lọc theo `author.accountId` của token
  (`fetchCurrentUser()`) rồi mới parse — nếu không, ô "Next task" của Bimo sẽ
  mở ra với kế hoạch của người khác ("Upload bản build IOS lên Testflight") và
  % carry-over lấy nhầm task của họ.

  Đo thật lúc đổi: PPP-341 có Jame ở vị trí #2 và #3, PPP-349 có Perry và
  Joseph ngay sau Bimo. Không tìm thấy comment nào của Bimo thì rơi về
  `defaultNextTasks` — đó là trạng thái **bình thường**, không phải lỗi
  (PPP-226 đúng như vậy).

  **Key lấy từ `href`, không phải từ text hiển thị.** Từ 21/09/2026 dòng báo
  cáo hiện tiêu đề chứ không hiện URL, nên key chỉ còn trong link. Bóc theo
  text chỉ khớp 1/21 dòng trên PPP-354; bóc theo `href` khớp 21/21.

  Dòng `80% → 100%` thì lấy **số cuối**.

- **JQL của Inbox đã được nới ngày 21/09/2026**, khi thêm filter status và
  người làm. Trước: `assignee = currentUser() AND status = "To Do"`. Sau:
  `project IN (...) AND assignee = currentUser() AND statusCategory != Done`,
  cộng thêm sub-task anh em qua `fetchChildren()`. Lọc thật nằm ở FE
  (`matchesFilters` trong `InboxPage`), mặc định vẫn là To Do + người dùng hiện
  tại nên màn hình mở ra giống hệt trước.

  **Phải giới hạn `project IN (...)`.** Bỏ ra thì JQL kéo về chính hai issue báo
  cáo PPP-354 / PPP-308 — chúng assign cho Bimo và nằm ở In Progress vĩnh viễn —
  cùng các project lạ (SPB, PPP khác). Đã gặp thật khi kiểm thử.

- **Đừng lọc task QA bằng `summary ~ "QA"` trong JQL.** Index full-text của
  Jira tách token theo từ: `QA_260827` là **một** token nên không khớp với
  `QA`, còn `[QA] ...` thì khớp. Đã đo trên board thật — clause đó tìm được 3
  trong 5 task QA, bỏ sót HWE-340 và HWE-343. Bỏ sót một task QA là kiểu lỗi
  tệ nhất ở đây vì nó làm nhãn "chưa có QA" nói sai. Lấy hết rồi khớp bằng
  regex ở tầng code (`QA_TITLE` trong `service.ts`).

- **Transition tra theo tên trạng thái, không hardcode id.** Trên HWE hiện tại
  id là `11` To Do · `21` In Progress · `31` Done · `51` Review, nhưng id là cấu
  hình workflow và đổi được khi board bị sửa. `transitionIssue()` gọi
  `/transitions` lấy danh sách rồi khớp theo tên.

- **JQL đọc từ search index, và index trễ hơn lệnh ghi.** Đã đo thật trên
  HWE-204 ngày 22/09/2026: transition trả về sau 962ms, `GET /issue/{key}` đọc
  thấy trạng thái mới ngay, nhưng JQL phải tới ~1589ms mới thấy.

  Hệ quả: gọi `load()` ngay sau khi chuyển trạng thái sẽ nhận lại **trạng thái
  cũ**. Bimo gặp thật — chuyển 4 task BE sang Done thì 3 cái biến mất còn
  HWE-479 vẫn nằm đó, vì nó là cái chuyển sau cùng nên index chưa kịp.

  Cách chữa **không phải** là `setTimeout` đợi rồi mới gọi lại — đoán bao lâu
  cho đủ là may rủi. `load()` nhận tham số `justMoved` (map key → status mới)
  và tin kết quả transition hơn payload: task chuyển sang Done thì loại khỏi
  danh sách luôn, task chuyển sang trạng thái khác thì vá lại status. Bỏ tick
  cũng phải theo danh sách sau khi vá, nếu không lần chuyển sau sẽ gửi kèm một
  task đã rời màn hình.

- **Bug chạy workflow riêng.** Đã tra `/rest/api/3/project/{key}/statuses` trên
  cả HWE, DT và SR — giống nhau cả ba:

  | Issue type | Trạng thái |
  | --- | --- |
  | Bug | `TO FIX` · `FIXING` · `Review` · `Done` |
  | Còn lại (Story, Sub-task, Task, Epic, Improvement) | `To Do` · `In Progress` · `Review` · `Done` |

  Dropdown ở màn Thao tác **không** liệt kê cứng nữa mà đổi theo task đang
  tick (`statusesFor()` trong `ActionsPage`). Tick lẫn Bug với loại khác thì
  chỉ còn `Review` và `Done` — hai trạng thái duy nhất cả hai workflow đều
  nhận. Trạng thái đang chọn tự nhảy về `Review` khi cái cũ hết hợp lệ, nếu
  không sẽ gửi lệnh Jira từ chối ngay.

  Vẫn còn trường hợp workflow không cho đi thẳng: HWE-529 ở `TO FIX` chỉ sang
  được `FIXING`, không nhảy thẳng `Done`. `transitionMany()` báo lỗi từng task
  và vẫn chạy tiếp — đó là chủ ý, không phải thiếu sót.

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
| Prefill "Next task" | Đọc ngược từ comment gần nhất, đúng cho cả ba dự án |
| Preview | Khớp mẫu nhà, tiếng Việt không lỗi font |
| **SportsRab** (23/09) | Tab hiện ở cả 3 menu. Handover 4 task (2 FE tôi + 2 BE Joseph), gom đúng 2 story SR-583/SR-584. Preview ngày 13/08 ra đúng SR-226/SR-228 như comment gốc, mention `@Ruby @Sumi`, đích PPP-351 |
| **Nhắn Slack** (22/09) | Đã gửi thật, hiện dưới tên MOBi không phải bot |
| **Task đang làm dở** (23/09) | Xem ngày 24/09 (chưa ai đổi status): vẫn ra SR-591/SR-589 gắn nhãn "đang làm", tick sẵn, % lấy từ báo cáo trước. Sửa 70→80% rồi dựng lại ra đúng mẫu |
| Đọc ngược % | PPP-354 bóc được 21/21 dòng, PPP-308 và PPP-351 mỗi cái 2/2 |
| type-check + build | Sạch cả hai phía |

**CHƯA chạy thật — cần Bimo bấm thử:**

- **Nút "Đăng báo cáo"** — sẽ post comment thật lên PPP-341 / PPP-226 /
  PPP-349.
- **Nút "Bắt đầu"** ở Inbox — sẽ đổi trạng thái task thật sang In Progress.
- **Menu Thao tác** — nút "Chuyển N task" đổi trạng thái hàng loạt, nút
  **"Giao N task"** đổi assignee hàng loạt, nút "+ QA" tạo sub-task thật. Phần đọc (`GET /targets/:id/handover`) đã kiểm trên dữ
  liệu thật: 27 task chưa xong, gom đúng 5 Story, phân đúng 14 FE / 12 BE.

Cả hai đều ghi lên Jira nên tôi không tự chạy. Code đã xong; nếu ADF có gì lệch
mẫu thì sửa `adf.ts`. **Khi kiểm thử, đừng post thử lên PPP-341/PPP-226/PPP-349** — đó
là issue báo cáo thật mà BA, PM **và cả team** đang đọc (càng không được post
bừa vì giờ là task chung, không phải sub-task riêng của Bimo). Tạo issue nháp
riêng để thử.

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
- **Nới JQL thống kê thành `updated >=`** — xem mục 4. Đã giải quyết vấn đề gốc
  bằng nguồn "đang làm dở" thay vì nới `updated`, nên hướng này khỏi bàn lại.
