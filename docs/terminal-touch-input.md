# Mobile Touch Scrolling

Termix terminals support one-finger touch scrolling on mobile devices. Touch
scrolling uses the terminal's normal wheel-input path so it works with both
regular shell scrollback and full-screen terminal applications.

## Scrolling a terminal

- Drag one finger vertically across the terminal to scroll directly.
- Release a fast swipe to continue with bounded momentum.
- Drag upward to move toward earlier output.
- Drag downward to move toward newer output.

The behavior follows the terminal's existing xterm wheel handling. This keeps
normal shell scrollback, tmux, alternate-screen applications, and terminal
mouse-reporting behavior aligned with desktop wheel input.

## Interaction behavior

- Small movements can be used as taps without starting a scroll.
- A second finger cancels the active one-finger scrolling gesture.
- `touchcancel` and terminal cleanup stop any active momentum.
- Text selection, paste, focus, and desktop mouse-wheel behavior remain separate
  from the mobile touch-scroll path.
- Reduced-motion preferences disable post-release momentum while preserving
  direct dragging.

## Momentum

Post-release momentum is intentionally bounded. It uses the release velocity and
an eased decay profile, then emits discrete wheel ticks through xterm. The
bounds prevent a fast swipe from producing unbounded scrolling or continuing
indefinitely.

The default profile is designed to feel like a short free-spin mouse gesture.
Administrators can expose and adjust the detailed Touch Input values from
`Admin Settings` when that feature is available.

## Normal shell scrollback and tmux

Normal shell output is handled by xterm's scrollback viewport. Full-screen
applications and tmux can receive wheel input through their normal alternate
buffer or mouse-reporting path. The touch gesture does not maintain a separate
history overlay or duplicate terminal history.

## Troubleshooting

If scrolling does not move the terminal:

1. Confirm that the terminal is connected.
2. Try a larger vertical drag instead of a tap-sized movement.
3. Check whether the application is consuming mouse input intentionally.
4. If reduced motion is enabled, remember that direct dragging still works but
   release momentum is disabled.
