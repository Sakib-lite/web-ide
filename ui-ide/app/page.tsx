'use client';

import dynamic from 'next/dynamic';

const IdeApp = dynamic(() => import('@/components/IdeApp'), { ssr: false });

export default function Page() {
  return <IdeApp />;
}
