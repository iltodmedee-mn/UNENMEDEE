import Link from "next/link";
import { Suspense } from "react";

import { CONTACT_EMAIL, REPO_URL, repoFile } from "@/lib/site";

import { DonateCard } from "./donate";
import { Logo } from "./logo";
import { SocialLinks } from "./social-links";

const footerLink = "text-tertiary transition hover:text-primary";

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-line bg-secondary pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 md:grid-cols-3 md:px-8">
        <div className="flex flex-col gap-4">
          <Logo withDomain />
          <p className="text-sm text-tertiary">
            Төрийн албан ёсны мэдээг баримт, пи-ар гэж ялгаж, эрсдэлтэй тендер, төсвийг AI-аар шүүдэг нээлттэй эхийн платформ.
          </p>
          <span className="label-mono w-fit rounded-md px-2 py-1 text-brand-secondary ring-1 ring-brand-soft ring-inset">● 0₮ дэд бүтэц · нээлттэй эх</span>
          <div className="flex flex-col gap-3 border-t border-line-soft pt-4">
            <p className="label-mono text-tertiary">Биднийг дагаарай</p>
            <SocialLinks size="lg" labels />
          </div>
          <div className="flex flex-col gap-1 border-t border-line-soft pt-4 text-sm">
            <p className="label-mono text-tertiary">Холбоо барих</p>
            <p className="text-tertiary">Санал хүсэлт, алдаа, хамтын ажиллагаа, хэвлэл мэдээллийн асуудлаар бичээрэй:</p>
            <a className="w-fit font-semibold text-brand-secondary hover:underline" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>
          </div>
        </div>
        <div className="flex flex-col gap-2 text-sm">
          <p className="label-mono mb-1 text-tertiary">Шалгах боломжтой</p>
          <Link className={footerLink} prefetch={false} href="/about">
            Бид хэн бэ
          </Link>
          <Link className={footerLink} prefetch={false} href="/transparency">
            Зардлын тайлан (AI токен бүрээр)
          </Link>
          <Link className={footerLink} prefetch={false} href="/projects">
            Мега төслүүд: хэдэн жил, хэдэн төгрөг
          </Link>
          <Link className={footerLink} prefetch={false} href="/prices">
            Махны үнэ, бензиний үнэ 15 жилээр
          </Link>
          <Link className={footerLink} prefetch={false} href="/changes">
            Төрийн сайтын засвар, устгалт
          </Link>
          <Link className={footerLink} prefetch={false} href="/clusters">
            Олон эх сурвалжид гарсан сэдвүүд
          </Link>
          <Link className={footerLink} prefetch={false} href="/archive">
            Архив
          </Link>
          <Link className={footerLink} prefetch={false} href="/sources">
            Хянаж буй бүх эх сурвалж
          </Link>
          <Link className={footerLink} prefetch={false} href="/method">
            Арга зүй: AI яаж ажилладаг вэ
          </Link>
          <Link className={footerLink} prefetch={false} href="/privacy">
            Нууцлалын бодлого
          </Link>
          <a className={footerLink} href={REPO_URL} target="_blank" rel="noreferrer">
            Эх код (GitHub, нээлттэй) ↗
          </a>
          <Link className="mt-3 font-semibold text-brand-secondary hover:underline" href="/support">
            💙 Ил тод мэдээг дэмжих
          </Link>
          <Suspense fallback={null}>
            <DonateCard />
          </Suspense>
        </div>
        <div className="flex flex-col gap-2 text-sm text-tertiary">
          <p className="label-mono mb-1 text-tertiary">Анхааруулга</p>
          <p>
            AI шинжилгээ нь алдаа гаргаж болно. Нийтлэл бүр эх .gov.mn холбоос болон SHA-256 хэштэй тул анхны тексттэй шууд тулгаж шалгана уу.
            Эрсдэлийн оноо нь AI-ийн үнэлгээ, буруутгал биш, анхаарах дохио юм.
          </p>
          <p className="text-xs text-quaternary">
            Агуулга:{" "}
            <a className="hover:text-tertiary hover:underline" href={repoFile("LICENSE-CONTENT.md")} target="_blank" rel="noreferrer license">
              CC BY 4.0
            </a>{" "}
            (эх сурвалжаа iltodmedee.mn гэж дурдана уу) · Код: MIT
          </p>
        </div>
      </div>
    </footer>
  );
}
