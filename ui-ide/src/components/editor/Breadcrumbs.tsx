'use client';

import { Fragment } from 'react';
import { FileIcon } from '@/components/ui/FileIcon';
import { locateInTree } from '@/components/project/tree-actions';

export function Breadcrumbs({ path }: { path: string }) {
  const segs = path.split('/');
  return (
    <div className="breadcrumbs">
      {segs.map((s, i) => {
        const partial = segs.slice(0, i + 1).join('/');
        const last = i === segs.length - 1;
        return (
          <Fragment key={partial}>
            <span className="crumb" onClick={() => locateInTree(partial)}>{last && <FileIcon name={s} />}{s}</span>
            {!last && <span className="sep">›</span>}
          </Fragment>
        );
      })}
    </div>
  );
}
