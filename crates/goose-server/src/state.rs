use axum::http::StatusCode;
use goose::execution::manager::AgentManager;
use goose::scheduler_trait::SchedulerTrait;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::AtomicUsize;
use std::sync::Arc;
use tokio::sync::{oneshot, Mutex};

use crate::routes::sampling::SamplingRequest;

type PendingSamplingRequests =
    Arc<Mutex<HashMap<String, (SamplingRequest, oneshot::Sender<bool>)>>>;

#[derive(Clone)]
pub struct AppState {
    pub(crate) agent_manager: Arc<AgentManager>,
    pub recipe_file_hash_map: Arc<Mutex<HashMap<String, PathBuf>>>,
    pub session_counter: Arc<AtomicUsize>,
    /// Tracks sessions that have already emitted recipe telemetry to prevent double counting.
    recipe_session_tracker: Arc<Mutex<HashSet<String>>>,
    /// Pending sampling requests awaiting approval
    pub(crate) pending_sampling_requests: PendingSamplingRequests,
    /// Broadcast channel for notifying about new sampling requests
    pub(crate) sampling_request_tx: Arc<tokio::sync::broadcast::Sender<SamplingRequest>>,
}

impl AppState {
    pub async fn new() -> anyhow::Result<Arc<AppState>> {
        let agent_manager = AgentManager::instance().await?;
        let (sampling_tx, _) = tokio::sync::broadcast::channel(100);
        Ok(Arc::new(Self {
            agent_manager,
            recipe_file_hash_map: Arc::new(Mutex::new(HashMap::new())),
            session_counter: Arc::new(AtomicUsize::new(0)),
            recipe_session_tracker: Arc::new(Mutex::new(HashSet::new())),
            pending_sampling_requests: Arc::new(Mutex::new(HashMap::new())),
            sampling_request_tx: Arc::new(sampling_tx),
        }))
    }

    pub async fn scheduler(&self) -> Result<Arc<dyn SchedulerTrait>, anyhow::Error> {
        self.agent_manager.scheduler().await
    }

    pub async fn set_recipe_file_hash_map(&self, hash_map: HashMap<String, PathBuf>) {
        let mut map = self.recipe_file_hash_map.lock().await;
        *map = hash_map;
    }

    pub async fn mark_recipe_run_if_absent(&self, session_id: &str) -> bool {
        let mut sessions = self.recipe_session_tracker.lock().await;
        if sessions.contains(session_id) {
            false
        } else {
            sessions.insert(session_id.to_string());
            true
        }
    }

    pub async fn get_agent(&self, session_id: String) -> anyhow::Result<Arc<goose::agents::Agent>> {
        let agent = self
            .agent_manager
            .get_or_create_agent(session_id.clone())
            .await?;

        // Set up sampling callback for this agent
        let state = Arc::new(self.clone());

        let callback: goose::agents::extension_manager::SamplingCallback = Arc::new(
            move |extension_name: String, params: rmcp::model::CreateMessageRequestParam| {
                let state = state.clone();

                Box::pin(async move {
                    use crate::routes::sampling::SamplingRequest;

                    // Create SamplingRequest directly from params
                    let request = SamplingRequest {
                        id: uuid::Uuid::new_v4().to_string(),
                        extension_name,
                        params,
                    };

                    // Add the sampling request and wait for approval
                    let rx = state.add_sampling_request(request).await?;

                    // Wait for the approval response
                    match rx.await {
                        Ok(approved) => Ok(approved),
                        Err(_) => Err(anyhow::anyhow!("Approval channel closed")),
                    }
                })
            },
        );

        agent
            .extension_manager
            .set_sampling_callback(callback)
            .await;

        Ok(agent)
    }

    /// Get agent for route handlers - always uses Interactive mode and converts any error to 500
    pub async fn get_agent_for_route(
        &self,
        session_id: String,
    ) -> Result<Arc<goose::agents::Agent>, StatusCode> {
        self.get_agent(session_id).await.map_err(|e| {
            tracing::error!("Failed to get agent: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })
    }

    /// Add a new sampling request and return a receiver for the approval response
    pub async fn add_sampling_request(
        &self,
        request: SamplingRequest,
    ) -> anyhow::Result<oneshot::Receiver<bool>> {
        let (tx, rx) = oneshot::channel();
        let request_id = request.id.clone();

        // Store the request and response channel
        self.pending_sampling_requests
            .lock()
            .await
            .insert(request_id.clone(), (request.clone(), tx));

        // Broadcast the request to any listening SSE clients
        let _ = self.sampling_request_tx.send(request);

        Ok(rx)
    }

    /// Respond to a sampling request with approval or rejection
    pub async fn respond_to_sampling_request(
        &self,
        request_id: &str,
        approved: bool,
    ) -> anyhow::Result<()> {
        let mut requests = self.pending_sampling_requests.lock().await;

        if let Some((_, tx)) = requests.remove(request_id) {
            // Send the approval/rejection response
            let _ = tx.send(approved);
            Ok(())
        } else {
            Err(anyhow::anyhow!(
                "Sampling request not found: {}",
                request_id
            ))
        }
    }

    /// Get all pending sampling requests
    pub async fn get_pending_sampling_requests(&self) -> Vec<SamplingRequest> {
        self.pending_sampling_requests
            .lock()
            .await
            .values()
            .map(|(req, _)| req.clone())
            .collect()
    }

    /// Subscribe to sampling request notifications
    pub fn subscribe_to_sampling_requests(
        &self,
    ) -> tokio::sync::broadcast::Receiver<SamplingRequest> {
        self.sampling_request_tx.subscribe()
    }
}
