import type { Metadata } from "next";

import { PageHeader } from "@/components/iltod/page-header";
import { Achievements } from "@/components/progress/achievements";

export const metadata: Metadata = {
  title: "Миний амжилт — түвшин, badge, дараалсан өдөр",
  alternates: { canonical: "/amjilt" },
  description: "Уншсан мэдээ, шалгасан баримт, дараалсан өдрөөрөө түвшин ахиж, badge цуглуулаарай. Ахиц зөвхөн таны төхөөрөмжид хадгалагдана.",
  // Every reader sees their own browser's progress: nothing here for a search engine.
  robots: { index: false, follow: true },
};

export default function AchievementsPage() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col pb-20 md:pb-0">
      <PageHeader eyebrow="Миний ахиц" title="🏅 Миний амжилт" description="Мэдээ бүтэн уншиж, баримтаа шалгаж, өдөр бүр ирвэл түвшин ахиж badge авна. Амархан биш: «Ил тод» шатанд жил орчим хүрнэ. Badge дээр дарвал хэрхэн авахыг харуулна." />
      <Achievements />
    </div>
  );
}
