//! Kiosk shell: one fullscreen webview (the React kiosk) + the local agent as a sidecar.
//!
//! The agent (Node) is started with the app, gets its data folder and API URL through env vars,
//! and is restarted if it exits. It is stopped when the window closes.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{AppHandle, Manager, RunEvent};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Values baked in at build time (CI sets them per environment).
const API_URL: Option<&str> = option_env!("PB_API_URL");
const SHORT_LINK_BASE: Option<&str> = option_env!("PB_SHORT_LINK_BASE");

#[derive(Default)]
struct AgentState {
    child: Option<CommandChild>,
    quitting: bool,
}

fn spawn_agent(app: &AppHandle, state: Arc<Mutex<AgentState>>) {
    let data_dir = app
        .path()
        .app_data_dir()
        .expect("app data dir")
        .join("agent");
    let resources = app.path().resource_dir().expect("resource dir");
    let entry = resources.join("agent").join("main.mjs");
    let script = resources.join("agent").join("print-image.ps1");

    let mut cmd = app
        .shell()
        .sidecar("pb-agent")
        .expect("pb-agent sidecar is bundled")
        .args([entry.to_string_lossy().to_string()])
        .env("NODE_ENV", "production")
        .env("PB_AGENT_DATA", data_dir.to_string_lossy().to_string())
        .env("PB_PRINT_SCRIPT", script.to_string_lossy().to_string())
        .env("PB_PRINT_MODE", "system")
        // The agent exits by itself if this process disappears (hard kill, crash).
        .env("PB_PARENT_PID", std::process::id().to_string());
    if let Some(url) = API_URL {
        cmd = cmd.env("PB_API_URL", url);
    }
    if let Some(base) = SHORT_LINK_BASE {
        cmd = cmd.env("PB_SHORT_LINK_BASE", base);
    }

    let (mut rx, child) = match cmd.spawn() {
        Ok(v) => v,
        Err(err) => {
            eprintln!("[kiosk] failed to start agent: {err}");
            return;
        }
    };
    state.lock().unwrap().child = Some(child);

    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) | CommandEvent::Stderr(line) => {
                    print!("[agent] {}", String::from_utf8_lossy(&line));
                }
                CommandEvent::Terminated(status) => {
                    eprintln!("[kiosk] agent exited: {:?}", status.code);
                    let quitting = {
                        let mut s = state.lock().unwrap();
                        s.child = None;
                        s.quitting
                    };
                    if !quitting {
                        // Keep the booth working: restart the agent after a short pause.
                        tokio::time::sleep(Duration::from_secs(2)).await;
                        spawn_agent(&app, state.clone());
                    }
                    break;
                }
                _ => {}
            }
        }
    });
}


#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = Arc::new(Mutex::new(AgentState::default()));
    let setup_state = state.clone();
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(move |app| {
            spawn_agent(app.handle(), setup_state.clone());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the kiosk app");

    app.run(move |_app, event| {
        if let RunEvent::Exit = event {
            let mut s = state.lock().unwrap();
            s.quitting = true;
            if let Some(child) = s.child.take() {
                let _ = child.kill();
            }
        }
    });
}
