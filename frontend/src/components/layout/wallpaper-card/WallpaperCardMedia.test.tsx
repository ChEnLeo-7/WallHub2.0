import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { WallpaperCardMedia } from './WallpaperCardMedia';

const mediaProps = {
  previewPending: false,
  title: 'Full cover',
  type: 'Scene',
  typeLabel: 'Scene',
  noCoverLabel: 'No cover',
  view: 'grid' as const,
  layoutAnimationEnabled: false,
  preserveAspectLayout: false as const,
  reducedMotion: false,
};

describe('WallpaperCardMedia cover reveal', () => {
  test('keeps the full cover transparent until it loads and then fades it in', () => {
    render(<WallpaperCardMedia {...mediaProps} previewUrl="https://full/cover.jpg" />);
    const image = screen.getByRole('img', { name: 'Full cover' });
    const placeholder = image.nextElementSibling;

    expect(image).toHaveClass('opacity-0');
    expect(image).toHaveClass('scale-[1.015]');
    expect(placeholder).toHaveClass('opacity-100');

    fireEvent.load(image);

    expect(image).toHaveClass('opacity-100');
    expect(image).toHaveClass('scale-100');
    expect(placeholder).toHaveClass('opacity-0');
  });

  test('restores the placeholder while a replacement cover loads', () => {
    const { rerender } = render(
      <WallpaperCardMedia {...mediaProps} previewUrl="https://full/first.jpg" />,
    );
    fireEvent.load(screen.getByRole('img', { name: 'Full cover' }));

    rerender(<WallpaperCardMedia {...mediaProps} previewUrl="https://full/second.jpg" />);

    const replacement = screen.getByRole('img', { name: 'Full cover' });
    expect(replacement).toHaveAttribute('src', 'https://full/second.jpg');
    expect(replacement).toHaveClass('opacity-0');
    expect(replacement.nextElementSibling).toHaveClass('opacity-100');
  });

  test('uses an opacity-only reveal when reduced motion is requested', () => {
    render(
      <WallpaperCardMedia
        {...mediaProps}
        previewUrl="https://full/cover.jpg"
        reducedMotion
      />,
    );

    const image = screen.getByRole('img', { name: 'Full cover' });
    expect(image).toHaveClass('transition-opacity');
    expect(image).toHaveClass('scale-100');
    expect(image).not.toHaveClass('scale-[1.015]');
    expect(image).not.toHaveClass('transition-[opacity,transform]');
  });

  test('shows the no-cover state when the full cover fails', () => {
    render(<WallpaperCardMedia {...mediaProps} previewUrl="https://full/cover.jpg" />);
    fireEvent.error(screen.getByRole('img', { name: 'Full cover' }));

    expect(screen.getByText('No cover')).toBeInTheDocument();
  });
});
