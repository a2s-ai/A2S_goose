import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';

/**
 * Represents a message in the sampling request
 */
interface SamplingMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Model preferences for the sampling request
 */
interface ModelPreferences {
  hints?: Array<{ name?: string }>;
  costPriority?: number;
  speedPriority?: number;
  intelligencePriority?: number;
}

/**
 * Props for the SamplingApprovalModal component
 */
export interface SamplingApprovalModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Name of the extension requesting approval */
  extensionName: string;
  /** Messages to be sent to the LLM */
  messages: SamplingMessage[];
  /** System prompt (if present) */
  systemPrompt?: string;
  /** Maximum tokens for the response */
  maxTokens: number;
  /** Model preferences (if present) */
  modelPreferences?: ModelPreferences;
  /** Callback when user approves the request */
  onApprove: () => void;
  /** Callback when user denies the request */
  onDeny: () => void;
}

/**
 * Extracts text content from a message content that can be either a string or structured content
 */
function extractMessageContent(content: string | { type: string; text?: string }[]): string {
  if (typeof content === 'string') {
    return content;
  }
  
  // For structured content, extract text from text blocks
  return content
    .filter((block) => block.type === 'text' && block.text)
    .map((block) => block.text)
    .join('\n');
}

/**
 * SamplingApprovalModal component displays a modal for approving or denying
 * sampling requests from MCP extensions.
 */
export function SamplingApprovalModal({
  isOpen,
  extensionName,
  messages,
  systemPrompt,
  maxTokens,
  modelPreferences,
  onApprove,
  onDeny,
}: SamplingApprovalModalProps) {
  const [isPending, setIsPending] = useState(false);

  const handleApprove = async () => {
    setIsPending(true);
    try {
      await onApprove();
    } finally {
      setIsPending(false);
    }
  };

  const handleDeny = () => {
    onDeny();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleDeny()}>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Approve Sampling Request</DialogTitle>
          <DialogDescription>
            The extension <span className="font-semibold text-text-default">{extensionName}</span>{' '}
            is requesting to use an LLM.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-4">
          {/* System Prompt Section */}
          {systemPrompt && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-text-default">System Prompt</h3>
              <div className="bg-background-muted rounded-md p-3 text-sm text-text-muted whitespace-pre-wrap max-h-32 overflow-y-auto">
                {systemPrompt}
              </div>
            </div>
          )}

          {/* Messages Section */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-text-default">
              Messages ({messages.length})
            </h3>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {messages.map((message, index) => (
                <div
                  key={index}
                  className="bg-background-muted rounded-md p-3 space-y-1"
                >
                  <div className="text-xs font-semibold text-text-accent uppercase">
                    {message.role}
                  </div>
                  <div className="text-sm text-text-default whitespace-pre-wrap">
                    {extractMessageContent(message.content)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Max Tokens Section */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-text-default">Max Tokens</h3>
            <div className="bg-background-muted rounded-md p-3 text-sm text-text-muted">
              {maxTokens}
            </div>
          </div>

          {/* Model Preferences Section */}
          {modelPreferences && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-text-default">Model Preferences</h3>
              <div className="bg-background-muted rounded-md p-3 space-y-2 text-sm text-text-muted">
                {modelPreferences.hints && modelPreferences.hints.length > 0 && (
                  <div>
                    <span className="font-semibold text-text-default">Hints: </span>
                    {modelPreferences.hints
                      .map((hint) => hint.name || 'unnamed')
                      .join(', ')}
                  </div>
                )}
                {modelPreferences.costPriority !== undefined && (
                  <div>
                    <span className="font-semibold text-text-default">Cost Priority: </span>
                    {modelPreferences.costPriority}
                  </div>
                )}
                {modelPreferences.speedPriority !== undefined && (
                  <div>
                    <span className="font-semibold text-text-default">Speed Priority: </span>
                    {modelPreferences.speedPriority}
                  </div>
                )}
                {modelPreferences.intelligencePriority !== undefined && (
                  <div>
                    <span className="font-semibold text-text-default">
                      Intelligence Priority:{' '}
                    </span>
                    {modelPreferences.intelligencePriority}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="pt-4">
          <Button
            variant="outline"
            onClick={handleDeny}
            disabled={isPending}
            className="border-red-500 text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
          >
            Deny
          </Button>
          <Button
            onClick={handleApprove}
            disabled={isPending}
            className="bg-green-600 hover:bg-green-700 text-white"
          >
            {isPending ? 'Approving...' : 'Approve'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
