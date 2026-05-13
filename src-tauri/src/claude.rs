use reqwest::header::{
    HeaderMap, HeaderValue, ACCEPT, CONTENT_TYPE, COOKIE, ORIGIN, REFERER, USER_AGENT,
};
use serde::{Deserialize, Serialize};

const UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UsageWindow {
    pub utilization: f64,
    pub resets_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UsageData {
    pub five_hour: Option<UsageWindow>,
    pub seven_day: Option<UsageWindow>,
    pub seven_day_sonnet: Option<UsageWindow>,
    pub org_name: Option<String>,
    pub name: Option<String>,
    pub email: Option<String>,
    pub fetched_at: String,
    pub source: String,
}

impl UsageData {
    #[allow(dead_code)]
    pub fn max_utilization(&self) -> Option<f64> {
        [
            self.five_hour.as_ref().map(|w| w.utilization),
            self.seven_day.as_ref().map(|w| w.utilization),
            self.seven_day_sonnet.as_ref().map(|w| w.utilization),
        ]
        .into_iter()
        .flatten()
        .reduce(f64::max)
    }
}

#[derive(Deserialize)]
struct OrgEntry {
    uuid: String,
    name: Option<String>,
}

#[derive(Deserialize)]
struct ApiWindow {
    utilization: f64,
    resets_at: Option<String>,
}

#[derive(Deserialize)]
struct ApiUsage {
    five_hour: Option<ApiWindow>,
    seven_day: Option<ApiWindow>,
    seven_day_sonnet: Option<ApiWindow>,
}

// Flexible account profile — tries multiple field names the API might use.
#[derive(Deserialize, Default)]
struct AccountProfile {
    email_address: Option<String>,
    email: Option<String>,
    full_name: Option<String>,
    name: Option<String>,
    display_name: Option<String>,
}

fn claude_headers(session_key: &str) -> HeaderMap {
    let mut h = HeaderMap::new();
    h.insert(COOKIE, HeaderValue::from_str(&format!("sessionKey={session_key}")).unwrap());
    h.insert(USER_AGENT, HeaderValue::from_static(UA));
    h.insert(ACCEPT, HeaderValue::from_static("application/json"));
    h.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    h.insert(REFERER, HeaderValue::from_static("https://claude.ai/"));
    h.insert(ORIGIN, HeaderValue::from_static("https://claude.ai"));
    h.insert("sec-fetch-site", HeaderValue::from_static("same-origin"));
    h.insert("sec-fetch-mode", HeaderValue::from_static("cors"));
    h.insert("sec-fetch-dest", HeaderValue::from_static("empty"));
    h
}

fn make_client() -> reqwest::Result<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
}

async fn fetch_user_profile(
    client: &reqwest::Client,
    headers: HeaderMap,
) -> (Option<String>, Option<String>) {
    let Ok(resp) = client
        .get("https://claude.ai/api/account")
        .headers(headers)
        .send()
        .await
    else {
        return (None, None);
    };

    if !resp.status().is_success() {
        return (None, None);
    }

    let Ok(profile) = resp.json::<AccountProfile>().await else {
        return (None, None);
    };

    let email = profile.email_address.or(profile.email);
    let name = profile.full_name.or(profile.name).or(profile.display_name);
    (name, email)
}

pub async fn fetch_claude_usage(session_key: &str) -> Result<UsageData, String> {
    let client = make_client().map_err(|e| e.to_string())?;
    let headers = claude_headers(session_key);

    // Step 1: get the organisation UUID
    let orgs_resp = client
        .get("https://claude.ai/api/organizations")
        .headers(headers.clone())
        .send()
        .await
        .map_err(|e| format!("Network error fetching orgs: {e}"))?;

    let status = orgs_resp.status();
    if status.as_u16() == 401 {
        return Err("Session key invalid or expired. Please sign in again.".to_string());
    }
    if !status.is_success() {
        return Err(format!("Claude.ai returned HTTP {status}"));
    }

    let orgs: Vec<OrgEntry> = orgs_resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse organisations: {e}"))?;

    let org = orgs.into_iter().next().ok_or("No organisation found on this account")?;

    // Step 2: fetch usage + user profile in parallel
    let usage_url = format!("https://claude.ai/api/organizations/{}/usage", org.uuid);
    let (usage_resp, (user_name, user_email)) = tokio::join!(
        client.get(&usage_url).headers(headers.clone()).send(),
        fetch_user_profile(&client, headers)
    );

    let usage_resp = usage_resp.map_err(|e| format!("Network error fetching usage: {e}"))?;
    let usage_status = usage_resp.status();
    if !usage_status.is_success() {
        return Err(format!("Usage endpoint returned HTTP {usage_status}"));
    }

    let api: ApiUsage = usage_resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse usage response: {e}"))?;

    Ok(UsageData {
        five_hour: api.five_hour.map(|w| UsageWindow { utilization: w.utilization, resets_at: w.resets_at }),
        seven_day: api.seven_day.map(|w| UsageWindow { utilization: w.utilization, resets_at: w.resets_at }),
        seven_day_sonnet: api.seven_day_sonnet.map(|w| UsageWindow { utilization: w.utilization, resets_at: w.resets_at }),
        org_name: org.name,
        name: user_name,
        email: user_email,
        fetched_at: chrono::Utc::now().to_rfc3339(),
        source: "claude_ai".to_string(),
    })
}

