import { StandalonePage } from "@/components/videos/standalone-page";

export const metadata = { title: "改善前後對照圖卡" };

export default function CardsPage() {
  return (
    <StandalonePage
      kind="BEFORE_AFTER_CARDS"
      description="局部通學區改善前後對照圖卡及全區重點改善工項宣傳圖，獨立於學校案件管理。本案規劃之通學區：同意備查完整報告書之日起 15 個工作天（學校案件填寫同意備查日後自動建立）；機關另行指定之通學區：通知次日起 15 個工作天。前一個工作天提醒您創稿。"
    />
  );
}
