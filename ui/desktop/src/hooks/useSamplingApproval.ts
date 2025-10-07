import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Represents a message in the sampling request
 */
interface SamplingMessage {
  role: string;
  content: string;
}

/**
 * Model preferences for the sampling request
 */
interface ModelPreferences {
  hints?: Array<{ name?: string }>;
  cost_priority?: number;
  speed_priority?: number;
  intelligence_priority?: number;
}

/**
 * A sampling request from an MCP extension
 */
export interface SamplingRequest {
  id: string;
  extension_name: string;
  messages: SamplingMessage[];
  system_prompt?: string;
  max_tokens: number;
  model_preferences?: ModelPreferences;
}

/**
 * Hook to manage sampling approval requests via SSE
 */
export function useSamplingApproval() {
  const [currentRequest, setCurrentRequest] = useState<SamplingRequest | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;
  const baseReconnectDelay = 1000; // 1 second

  /**
   * Connect to the SSE stream
   */
  const connect = useCallback(async () => {
    try {
      // Clean up existing connection
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }

      // Get the backend URL and secret key
      const baseUrl = await window.electron.getGoosedHostPort();
      const secretKey = await window.electron.getSecretKey();

      if (!baseUrl) {
        throw new Error('Backend URL not available');
      }

      // Create SSE connection with authentication
      const url = new URL('/sampling/stream', baseUrl);
      const eventSource = new EventSource(url.toString());

      // Store authentication in a custom header (EventSource doesn't support custom headers directly)
      // We'll need to rely on the backend accepting the secret key via query param or cookie
      // For now, we'll assume the backend is on localhost and shares the same secret

      eventSource.onopen = () => {
        console.log('[SamplingApproval] SSE connection established');
        setIsConnected(true);
        setError(null);
        reconnectAttemptsRef.current = 0;
      };

      eventSource.onmessage = (event) => {
        try {
          const request = JSON.parse(event.data) as SamplingRequest;
          console.log('[SamplingApproval] Received sampling request:', request);
          setCurrentRequest(request);
        } catch (err) {
          console.error('[SamplingApproval] Failed to parse sampling request:', err);
          setError(err instanceof Error ? err : new Error('Failed to parse sampling request'));
        }
      };

      eventSource.onerror = (err) => {
        console.error('[SamplingApproval] SSE connection error:', err);
        setIsConnected(false);

        // Close the connection
        eventSource.close();
        eventSourceRef.current = null;

        // Attempt to reconnect with exponential backoff
        if (reconnectAttemptsRef.current < maxReconnectAttempts) {
          const delay = baseReconnectDelay * Math.pow(2, reconnectAttemptsRef.current);
          console.log(
            `[SamplingApproval] Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current + 1}/${maxReconnectAttempts})`
          );

          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectAttemptsRef.current++;
            connect();
          }, delay);
        } else {
          console.error('[SamplingApproval] Max reconnection attempts reached');
          setError(new Error('Failed to connect to sampling stream after multiple attempts'));
        }
      };

      eventSourceRef.current = eventSource;
    } catch (err) {
      console.error('[SamplingApproval] Failed to connect to SSE stream:', err);
      setError(err instanceof Error ? err : new Error('Failed to connect to sampling stream'));
      setIsConnected(false);
    }
  }, []);

  /**
   * Disconnect from the SSE stream
   */
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    setIsConnected(false);
    reconnectAttemptsRef.current = 0;
  }, []);

  /**
   * Approve a sampling request
   */
  const approve = useCallback(
    async (requestId: string) => {
      try {
        const baseUrl = await window.electron.getGoosedHostPort();
        const secretKey = await window.electron.getSecretKey();

        if (!baseUrl) {
          throw new Error('Backend URL not available');
        }

        const response = await fetch(`${baseUrl}/sampling/${requestId}/approve`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Secret-Key': secretKey,
          },
          body: JSON.stringify({ approved: true }),
        });

        if (!response.ok) {
          throw new Error(`Failed to approve request: ${response.statusText}`);
        }

        console.log('[SamplingApproval] Request approved:', requestId);
        setCurrentRequest(null);
      } catch (err) {
        console.error('[SamplingApproval] Failed to approve request:', err);
        throw err;
      }
    },
    []
  );

  /**
   * Deny a sampling request
   */
  const deny = useCallback(
    async (requestId: string) => {
      try {
        const baseUrl = await window.electron.getGoosedHostPort();
        const secretKey = await window.electron.getSecretKey();

        if (!baseUrl) {
          throw new Error('Backend URL not available');
        }

        const response = await fetch(`${baseUrl}/sampling/${requestId}/approve`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Secret-Key': secretKey,
          },
          body: JSON.stringify({ approved: false }),
        });

        if (!response.ok) {
          throw new Error(`Failed to deny request: ${response.statusText}`);
        }

        console.log('[SamplingApproval] Request denied:', requestId);
        setCurrentRequest(null);
      } catch (err) {
        console.error('[SamplingApproval] Failed to deny request:', err);
        throw err;
      }
    },
    []
  );

  /**
   * Clear the current request (e.g., on modal close without action)
   */
  const clearCurrentRequest = useCallback(() => {
    setCurrentRequest(null);
  }, []);

  // Connect on mount, disconnect on unmount
  useEffect(() => {
    connect();

    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  return {
    currentRequest,
    isConnected,
    error,
    approve,
    deny,
    clearCurrentRequest,
    reconnect: connect,
  };
}
