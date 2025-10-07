import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SamplingApprovalModal } from './SamplingApprovalModal';

describe('SamplingApprovalModal', () => {
  const defaultProps = {
    isOpen: true,
    extensionName: 'test-extension',
    messages: [
      { role: 'user' as const, content: 'Hello, world!' },
      { role: 'assistant' as const, content: 'Hi there!' },
    ],
    maxTokens: 1000,
    onApprove: vi.fn(),
    onDeny: vi.fn(),
  };

  it('renders the modal when open', () => {
    render(<SamplingApprovalModal {...defaultProps} />);
    
    expect(screen.getByText('Approve Sampling Request')).toBeInTheDocument();
    expect(screen.getByText(/test-extension/)).toBeInTheDocument();
  });

  it('displays messages correctly', () => {
    render(<SamplingApprovalModal {...defaultProps} />);
    
    expect(screen.getByText('Hello, world!')).toBeInTheDocument();
    expect(screen.getByText('Hi there!')).toBeInTheDocument();
  });

  it('displays system prompt when provided', () => {
    const propsWithSystemPrompt = {
      ...defaultProps,
      systemPrompt: 'You are a helpful assistant.',
    };
    
    render(<SamplingApprovalModal {...propsWithSystemPrompt} />);
    
    expect(screen.getByText('System Prompt')).toBeInTheDocument();
    expect(screen.getByText('You are a helpful assistant.')).toBeInTheDocument();
  });

  it('displays max tokens', () => {
    render(<SamplingApprovalModal {...defaultProps} />);
    
    expect(screen.getByText('Max Tokens')).toBeInTheDocument();
    expect(screen.getByText('1000')).toBeInTheDocument();
  });

  it('displays model preferences when provided', () => {
    const propsWithPreferences = {
      ...defaultProps,
      modelPreferences: {
        hints: [{ name: 'gpt-4' }],
        costPriority: 0.5,
        speedPriority: 0.8,
        intelligencePriority: 0.9,
      },
    };
    
    render(<SamplingApprovalModal {...propsWithPreferences} />);
    
    expect(screen.getByText('Model Preferences')).toBeInTheDocument();
    expect(screen.getByText(/gpt-4/)).toBeInTheDocument();
  });

  it('calls onApprove when approve button is clicked', async () => {
    const onApprove = vi.fn();
    render(<SamplingApprovalModal {...defaultProps} onApprove={onApprove} />);
    
    const approveButton = screen.getByRole('button', { name: /approve/i });
    fireEvent.click(approveButton);
    
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it('calls onDeny when deny button is clicked', () => {
    const onDeny = vi.fn();
    render(<SamplingApprovalModal {...defaultProps} onDeny={onDeny} />);
    
    const denyButton = screen.getByRole('button', { name: /deny/i });
    fireEvent.click(denyButton);
    
    expect(onDeny).toHaveBeenCalledTimes(1);
  });

  it('handles structured message content', () => {
    const propsWithStructuredContent = {
      ...defaultProps,
      messages: [
        {
          role: 'user' as const,
          content: [
            { type: 'text', text: 'First part' },
            { type: 'text', text: 'Second part' },
          ],
        },
      ],
    };
    
    render(<SamplingApprovalModal {...propsWithStructuredContent} />);
    
    expect(screen.getByText(/First part/)).toBeInTheDocument();
    expect(screen.getByText(/Second part/)).toBeInTheDocument();
  });
});
