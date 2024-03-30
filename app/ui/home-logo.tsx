import { ChartBarIcon } from '@heroicons/react/24/outline';
import { lusitana } from '@/app/ui/fonts';

export default function HomeLogo() {
  return (
    <div
      className={`${lusitana.className} flex flex-row items-center leading-none text-white`}
    >
      <ChartBarIcon className="h-12 w-12" />
      <p className="text-[24px]">Playwright Server</p>
    </div>
  );
}
