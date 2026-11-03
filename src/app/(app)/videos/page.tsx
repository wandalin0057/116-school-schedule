import { StandalonePage } from "@/components/videos/standalone-page";

export const metadata = { title: "成果影片" };

export default function VideosPage() {
  return <StandalonePage kind="RESULT_VIDEO" description="成果影片獨立於通學區學校案件管理（製作影片的學校可能不同）。3 分鐘影片：機關通知次日起 20 個工作天；15 秒版本：審核同意通知次日起 10 個工作天；皆於前一個工作天創稿發文。" />;
}
