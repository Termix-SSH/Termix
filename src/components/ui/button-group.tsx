import { Children, ReactElement, cloneElement, isValidElement } from 'react';

import { type ButtonProps } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ButtonGroupProps {
  className?: string;
  orientation?: 'horizontal' | 'vertical';
  children: ReactElement<ButtonProps>[] | React.ReactNode;
}

export const ButtonGroup = ({
  className,
  orientation = 'horizontal',
  children,
}: ButtonGroupProps) => {
  const isHorizontal = orientation === 'horizontal';
  const isVertical = orientation === 'vertical';

  // Normalize and filter only valid React elements
  const childArray = Children.toArray(children).filter((child): child is ReactElement<ButtonProps> =>
    isValidElement(child)
  );
  const totalButtons = childArray.length;

  return (
    <div
      className={cn(
        'flex',
        {
          'flex-col': isVertical,
          'w-fit': isVertical,
        },
        className
      )}
    >
      {childArray.map((child, index) => {
        const isFirst = index === 0;
        const isLast = index === totalButtons - 1;

        return cloneElement(child, {
          className: cn(
            {
              'rounded-l-none': isHorizontal && !isFirst,
              'rounded-r-none': isHorizontal && !isLast,
              'border-l-0': isHorizontal && !isFirst,

              'rounded-t-none': isVertical && !isFirst,
              'rounded-b-none': isVertical && !isLast,
              'border-t-0': isVertical && !isFirst,
            },
            child.props.className
          ),
        });
      })}
    </div>
  );
};