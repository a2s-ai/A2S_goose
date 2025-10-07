use crate::routes::sampling::SamplingRequest;
use crate::state::AppState;
use goose::agents::mcp_client::SamplingHandler;
use goose::providers::base::Provider;
use rmcp::model::{Content, CreateMessageRequestParam, CreateMessageResult, Role, SamplingMessage};
use rmcp::ServiceError;
use std::sync::Arc;
use tokio::sync::Mutex;
use uuid::Uuid;

/// Server-side sampling handler that requests human approval before processing
pub struct ServerSamplingHandler {
    provider: Arc<Mutex<Option<Arc<dyn Provider>>>>,
    extension_name: String,
    app_state: Arc<AppState>,
}

impl ServerSamplingHandler {
    pub fn new(
        provider: Arc<Mutex<Option<Arc<dyn Provider>>>>,
        extension_name: String,
        app_state: Arc<AppState>,
    ) -> Self {
        Self {
            provider,
            extension_name,
            app_state,
        }
    }
}

#[async_trait::async_trait]
impl SamplingHandler for ServerSamplingHandler {
    async fn handle_create_message(
        &self,
        params: CreateMessageRequestParam,
        _extension_name: String,
    ) -> Result<CreateMessageResult, ServiceError> {
        // Create a sampling request for human approval
        let request_id = Uuid::new_v4().to_string();
        
        let sampling_request = SamplingRequest {
            id: request_id.clone(),
            extension_name: self.extension_name.clone(),
            params: params.clone(),
        };

        // Add the sampling request and get a receiver for the approval response
        let approval_rx = self
            .app_state
            .add_sampling_request(sampling_request)
            .await
            .map_err(|_| ServiceError::UnexpectedResponse)?;

        // Wait for human approval or rejection
        let approved = approval_rx
            .await
            .map_err(|_| ServiceError::UnexpectedResponse)?;

        if !approved {
            // User rejected the sampling request
            return Err(ServiceError::Cancelled { reason: Some("User rejected sampling request".to_string()) });
        }

        // User approved - proceed with the sampling request using the provider
        let provider_lock = self.provider.lock().await;
        let provider = provider_lock
            .as_ref()
            .ok_or_else(|| ServiceError::UnexpectedResponse)?
            .clone();
        drop(provider_lock);

        // Convert SamplingMessage to Message for the provider
        let messages: Vec<goose::conversation::message::Message> = params
            .messages
            .iter()
            .map(|msg| {
                let mut message = match msg.role {
                    Role::User => goose::conversation::message::Message::user(),
                    Role::Assistant => goose::conversation::message::Message::assistant(),
                };
                // Add content - convert Content to MessageContent
                if let Some(text) = msg.content.as_text() {
                    message = message.with_text(&text.text);
                } else {
                    // Handle other content types if needed
                    message = message.with_content(msg.content.clone().into());
                }
                message
            })
            .collect();

        // Use system prompt from params or default
        let system_prompt = params
            .system_prompt
            .as_deref()
            .unwrap_or("You are a helpful assistant");

        // Call the provider's complete method
        let (response, usage) = provider
            .complete(system_prompt, &messages, &[])
            .await
            .map_err(|_e| ServiceError::UnexpectedResponse)?;

        // Extract the response content - convert MessageContent to Content
        let response_content = if let Some(content) = response.content.first() {
            match content {
                goose::conversation::message::MessageContent::Text(text) => {
                    Content::text(&text.text)
                }
                goose::conversation::message::MessageContent::Image(img) => {
                    Content::image(&img.data, &img.mime_type)
                }
                _ => Content::text(""),
            }
        } else {
            Content::text("")
        };

        // Create the result
        let result = CreateMessageResult {
            model: usage.model,
            stop_reason: Some(CreateMessageResult::STOP_REASON_END_TURN.to_string()),
            message: SamplingMessage {
                role: Role::Assistant,
                content: response_content,
            },
        };

        Ok(result)
    }
}
