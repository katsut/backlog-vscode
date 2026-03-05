import React, { useRef, useEffect } from 'react';

interface PanelResizerProps {
  targetId: string;
  minWidth?: number;
  maxWidthRatio?: number;
}

export const PanelResizer: React.FC<PanelResizerProps> = ({
  targetId,
  minWidth = 200,
  maxWidthRatio = 0.6,
}) => {
  const resizerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const resizer = resizerRef.current;
    if (!resizer) return;

    let isResizing = false;
    let startX = 0;
    let startWidth = 0;

    const handleMouseDown = (e: MouseEvent) => {
      const target = document.getElementById(targetId);
      if (!target) return;

      isResizing = true;
      startX = e.clientX;
      startWidth = target.getBoundingClientRect().width;
      resizer.classList.add('dragging');
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const target = document.getElementById(targetId);
      if (!target) return;

      const delta = startX - e.clientX;
      const newWidth = Math.max(minWidth, Math.min(startWidth + delta, window.innerWidth * maxWidthRatio));
      target.style.width = newWidth + 'px';
    };

    const handleMouseUp = () => {
      if (!isResizing) return;
      isResizing = false;
      resizer.classList.remove('dragging');
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };

    resizer.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      resizer.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [targetId, minWidth, maxWidthRatio]);

  return <div ref={resizerRef} className="panel-resizer" />;
};
