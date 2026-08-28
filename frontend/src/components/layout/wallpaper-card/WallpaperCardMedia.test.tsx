import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { WallpaperCardMedia } from './WallpaperCardMedia';

const mediaProps = {
  previewPending: false,
  title: 'Full cover',
  type: 'Scene',
  typeLabel: 'Scene',
  noCoverLabel: 'No cover',
  coverNetworkErrorLabel: 'Cover unavailable due to a network error',
  view: 'grid' as const,
  layoutAnimationEnabled: false,
  preserveAspectLayout: false as const,
  reducedMotion: false,
};

describe('WallpaperCardMedia cover reveal', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

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

  test('retries a failed cover after one and three seconds before showing a network problem', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-13T00:00:00Z'));
    render(<WallpaperCardMedia {...mediaProps} previewUrl="https://full/cover.jpg" />);
    const original = screen.getByRole('img', { name: 'Full cover' });
    fireEvent.error(original);

    expect(screen.queryByText('Cover unavailable due to a network error')).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1000));
    const firstRetry = screen.getByRole('img', { name: 'Full cover' });
    expect(firstRetry).toHaveAttribute('src', expect.stringContaining('wallhub_cover_retry=1-'));
    fireEvent.error(firstRetry);

    act(() => vi.advanceTimersByTime(2999));
    expect(screen.getByRole('img', { name: 'Full cover' })).toBe(firstRetry);
    act(() => vi.advanceTimersByTime(1));
    const secondRetry = screen.getByRole('img', { name: 'Full cover' });
    expect(secondRetry).toHaveAttribute('src', expect.stringContaining('wallhub_cover_retry=2-'));
    fireEvent.error(secondRetry);

    expect(screen.getByText('Cover unavailable due to a network error')).toBeInTheDocument();
    expect(screen.queryByText('No cover')).not.toBeInTheDocument();
  });

  test('stops retrying when a replacement request loads successfully', () => {
    vi.useFakeTimers();
    render(<WallpaperCardMedia {...mediaProps} previewUrl="https://full/cover.jpg" />);
    fireEvent.error(screen.getByRole('img', { name: 'Full cover' }));
    act(() => vi.advanceTimersByTime(1000));
    fireEvent.load(screen.getByRole('img', { name: 'Full cover' }));
    act(() => vi.advanceTimersByTime(10000));

    expect(screen.getByRole('img', { name: 'Full cover' })).toHaveClass('opacity-100');
    expect(screen.queryByText('Cover unavailable due to a network error')).not.toBeInTheDocument();
  });

  test('cancels a pending retry when details provide a different cover URL', () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <WallpaperCardMedia {...mediaProps} previewUrl="https://full/old.jpg" />,
    );
    fireEvent.error(screen.getByRole('img', { name: 'Full cover' }));

    rerender(<WallpaperCardMedia {...mediaProps} previewUrl="https://full/new.jpg" />);
    act(() => vi.advanceTimersByTime(5000));

    expect(screen.getByRole('img', { name: 'Full cover' })).toHaveAttribute('src', 'https://full/new.jpg');
    expect(screen.queryByText('Cover unavailable due to a network error')).not.toBeInTheDocument();
  });

  test('keeps the no-cover state when no cover URL exists', () => {
    render(<WallpaperCardMedia {...mediaProps} />);

    expect(screen.getByText('No cover')).toBeInTheDocument();
  });
});
