use crate::state::AppState;
use axum::{
    extract::{Path, State},
    http::{self, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use bytes::Bytes;
use futures::Stream;
use rmcp::model::CreateMessageRequestParam;
use serde::{Deserialize, Serialize};
use std::{
    convert::Infallible,
    pin::Pin,
    sync::Arc,
    task::{Context, Poll},
};
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub struct SamplingRequest {
    pub id: String,
    pub extension_name: String,
    #[serde(flatten)]
    pub params: CreateMessageRequestParam,
}

#[derive(Debug, Serialize, Deserialize, utoipa::ToSchema)]
pub struct ApprovalRequest {
    pub approved: bool,
}

#[derive(Debug, Serialize, Deserialize, utoipa::ToSchema)]
pub struct ApprovalResponse {
    pub success: bool,
}

#[utoipa::path(
    get,
    path = "/sampling/pending",
    responses(
        (status = 200, description = "List of pending sampling requests", body = Vec<SamplingRequest>),
        (status = 500, description = "Internal server error")
    )
)]
async fn get_pending_requests(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<SamplingRequest>>, StatusCode> {
    let pending = state.get_pending_sampling_requests().await;
    Ok(Json(pending))
}

#[utoipa::path(
    post,
    path = "/sampling/{request_id}/approve",
    request_body = ApprovalRequest,
    responses(
        (status = 200, description = "Approval recorded successfully", body = ApprovalResponse),
        (status = 404, description = "Request not found"),
        (status = 500, description = "Internal server error")
    )
)]
async fn approve_sampling_request(
    State(state): State<Arc<AppState>>,
    Path(request_id): Path<String>,
    Json(payload): Json<ApprovalRequest>,
) -> Result<Json<ApprovalResponse>, StatusCode> {
    state
        .respond_to_sampling_request(&request_id, payload.approved)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;

    Ok(Json(ApprovalResponse { success: true }))
}

pub struct SseResponse {
    stream: Pin<Box<dyn Stream<Item = Result<Bytes, Infallible>> + Send>>,
}

impl Stream for SseResponse {
    type Item = Result<Bytes, Infallible>;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        self.stream.as_mut().poll_next(cx)
    }
}

impl IntoResponse for SseResponse {
    fn into_response(self) -> axum::response::Response {
        let body = axum::body::Body::from_stream(self);

        http::Response::builder()
            .header("Content-Type", "text/event-stream")
            .header("Cache-Control", "no-cache")
            .header("Connection", "keep-alive")
            .body(body)
            .unwrap()
    }
}

#[utoipa::path(
    get,
    path = "/sampling/stream",
    responses(
        (status = 200, description = "SSE stream of sampling requests", content_type = "text/event-stream"),
        (status = 500, description = "Internal server error")
    )
)]
async fn stream_sampling_requests(
    State(state): State<Arc<AppState>>,
) -> Result<SseResponse, StatusCode> {
    let rx = state.subscribe_to_sampling_requests();
    let stream = BroadcastStream::new(rx);

    let mapped_stream = stream.filter_map(|result| {
        match result {
            Ok(request) => {
                // Serialize the request to JSON
                match serde_json::to_string(&request) {
                    Ok(json) => {
                        // Format as SSE event
                        let sse_data = format!("data: {}\n\n", json);
                        Some(Ok(Bytes::from(sse_data)))
                    }
                    Err(e) => {
                        tracing::error!("Failed to serialize sampling request: {}", e);
                        None
                    }
                }
            }
            Err(e) => {
                tracing::error!("Broadcast stream error: {}", e);
                None
            }
        }
    });

    Ok(SseResponse {
        stream: Box::pin(mapped_stream),
    })
}

pub fn routes(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/sampling/pending", get(get_pending_requests))
        .route("/sampling/stream", get(stream_sampling_requests))
        .route(
            "/sampling/{request_id}/approve",
            post(approve_sampling_request),
        )
        .with_state(state)
}
