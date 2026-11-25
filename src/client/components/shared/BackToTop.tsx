import React, { useState, useEffect } from 'react';
import { ArrowUp } from 'lucide-react';

interface BackToTopProps {
  scrollContainerId?: string;
  threshold?: number;
}

export const BackToTop: React.FC<BackToTopProps> = ({
  scrollContainerId = 'main-scroll-viewport',
  threshold = 300,
}) => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const container = document.getElementById(scrollContainerId) || window;

    const handleScroll = () => {
      const scrollY = container instanceof Window ? container.scrollY : container.scrollTop;
      if (scrollY > threshold) {
        setVisible(true);
      } else {
        setVisible(false);
      }
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [scrollContainerId, threshold]);

  const scrollToTop = () => {
    const container = document.getElementById(scrollContainerId) || window;
    if (container instanceof Window) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      container.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  if (!visible) return null;

  return (
    <button
      type="button"
      onClick={scrollToTop}
      aria-label="Scroll back to top"
      title="Back to Top"
      className="fixed bottom-[134px] right-4 md:bottom-20 md:right-5 z-40 p-2.5 rounded-xl bg-white dark:bg-[#162238] hover:bg-slate-50 dark:hover:bg-[#1E2D45] text-slate-700 dark:text-slate-200 shadow-md border border-slate-200 dark:border-[#24344F] transition-all hover:-translate-y-0.5 active:scale-95 cursor-pointer"
    >
      <ArrowUp className="w-4 h-4 stroke-[2.25]" />
    </button>
  );
};
