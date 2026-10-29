import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { App } from '../app';

describe('App', () => {
  it('renders the Lidurak heading', () => {
    render(<App />);
    expect(screen.getByRole('heading').textContent).toBe('Lidurak');
  });
});
