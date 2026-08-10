import * as React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { Dialog } from './dialog';

describe('Dialog', () => {
  test('closes from Escape and the backdrop when dismissible', () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog open onOpenChange={onOpenChange} title="Settings">
        Dialog body
      </Dialog>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Settings' });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    fireEvent.mouseDown(dialog.parentElement as HTMLElement);

    expect(onOpenChange).toHaveBeenNthCalledWith(1, false);
    expect(onOpenChange).toHaveBeenNthCalledWith(2, false);
  });

  test('ignores Escape and backdrop clicks when not dismissible', () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog open dismissible={false} onOpenChange={onOpenChange} title="Required setup">
        Dialog body
      </Dialog>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Required setup' });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    fireEvent.mouseDown(dialog.parentElement as HTMLElement);

    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '关闭' })).not.toBeInTheDocument();
  });

  test('locks page scrolling, focuses the panel, and restores focus on close', async () => {
    const user = userEvent.setup();

    function Harness() {
      const [open, setOpen] = React.useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open dialog</button>
          <Dialog open={open} onOpenChange={setOpen} title="Details">
            Dialog body
          </Dialog>
        </>
      );
    }

    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Open dialog' });
    await user.click(trigger);

    const dialog = screen.getByRole('dialog', { name: 'Details' });
    await waitFor(() => expect(dialog).toHaveFocus());
    expect(document.body).toHaveStyle({ overflow: 'hidden' });

    await user.click(screen.getByRole('button', { name: '关闭' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Details' })).not.toBeInTheDocument());
    expect(document.body.style.overflow).toBe('');
    expect(trigger).toHaveFocus();
  });
});
