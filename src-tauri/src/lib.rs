pub mod appearance;
pub mod commands;
pub mod db;
pub mod edit_menu;
pub mod models;
pub mod info_window;
pub mod settings_window;
pub mod view_menu;

use db::run_migrations;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_data_dir)?;

            // Restore from Backup… restarts the app; its database and settings go in before anything opens them
            if let Ok(config_dir) = app.path().app_config_dir() {
                if let Err(e) = commands::backup::apply_staged_restore(&app_data_dir, &config_dir) {
                    eprintln!("couldn't finish restoring a backup: {e}");
                }
            }

            let pool = tauri::async_runtime::block_on(
                sqlx::sqlite::SqlitePoolOptions::new().connect_with(
                    sqlx::sqlite::SqliteConnectOptions::new()
                        .filename(app_data_dir.join("folderbase.db"))
                        .create_if_missing(true),
                ),
            )?;

            tauri::async_runtime::block_on(run_migrations(&pool))?;

            // Settings that take effect in Rust (Show hidden files), before anything is indexed
            if let Ok(dir) = app.path().app_config_dir() {
                commands::settings::apply(&commands::settings::load(&dir));
            }
            app.manage(pool);
            commands::backup::start_schedule(app.handle().clone());
            app.manage(settings_window::PendingPane::default());
            app.manage(info_window::InfoWindows::default());
            appearance::setup(app)?;
            // macOS routes Cmd-Z through the menu bar; elsewhere the frontend's shortcuts handle it
            #[cfg(target_os = "macos")]
            if let Some(menu) = app.menu() {
                edit_menu::install(app, &menu)?;
                view_menu::install(app, &menu)?;
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // An Info window closed: its file can have a new one
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(state) = window.try_state::<info_window::InfoWindows>() {
                    state.forget(window.label());
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::admin::clear_database,
            commands::admin::open_path,
            commands::admin::open_paths,
            commands::open_with::apps_for_paths,
            commands::open_with::open_paths_with,
            commands::open_with::reveal_paths,
            commands::quick_look::quick_look,
            commands::quick_look::quick_look_update,
            commands::quick_look::quick_look_close,
            commands::preview_view::preview_view_show,
            commands::preview_view::preview_view_hide,
            view_menu::set_view_menu_state,
            commands::compress::compress_items,
            commands::compress::cancel_compress,
            commands::settings::get_app_settings,
            commands::settings::set_zip_folder,
            commands::settings::set_backup_folder,
            commands::backup::backup_suggestion,
            commands::backup::back_up_database,
            commands::backup::inspect_backup,
            commands::backup::restore_from_backup,
            commands::settings::set_app_settings,
            commands::settings::reset_app_settings,
            commands::settings::get_storage_info,
            commands::settings::clear_thumbnail_cache,
            appearance::get_appearance,
            appearance::set_appearance,
            settings_window::open_settings,
            settings_window::settings_initial_pane,
            info_window::open_info_windows,
            info_window::toggle_inspector_window,
            info_window::info_window_path,
            commands::open_with::set_default_app,
            commands::files::get_files_by_paths,
            commands::feedback::haptic_feedback,
            commands::files::get_libraries,
            commands::icons::get_native_icon,
            commands::thumbnails::get_thumbnail,
            commands::files::get_files,
            commands::files::get_files_for_location,
            commands::files::update_file_metadata,
            commands::files::add_file,
            commands::files::set_file_metadata_batch,
            commands::virtual_folder::query_virtual_folder,
            commands::virtual_folder::get_path_metadata,
            commands::virtual_folder::create_virtual_folder,
            commands::ingest::ingest_directory,
            commands::ingest::stop_refresh,
            commands::import::import_files,
            commands::import::trash_added_files,
            commands::import::copy_to_location,
            commands::import::set_added_folder,
            commands::drag_out::drag_out,
            commands::locations::get_locations,
            commands::locations::add_location,
            commands::locations::delete_location,
            commands::locations::rename_location,
            commands::locations::reorder_locations,
            commands::locations::relocate_location,
            commands::locations::location_available,
            commands::location_views::get_location_views,
            commands::location_views::save_location_view,
            commands::location_views::delete_location_view,
            commands::location_views::reorder_location_views,
            commands::location_views::set_default_location_view,
            commands::properties::get_properties,
            commands::properties::get_property_values,
            commands::properties::create_property,
            commands::properties::update_property_type,
            commands::properties::create_property_value,
            commands::properties::delete_property_value,
            commands::properties::delete_property,
            commands::scopes::get_property_scopes,
            commands::rules::get_rules,
            commands::rules::save_rule,
            commands::rules::delete_rule,
            commands::rules::reorder_rules,
            commands::rules::get_rule_writes,
            commands::rules::apply_rule_writes,
            commands::rules::forget_rule_writes,
            commands::scopes::set_property_scope,
            commands::metadata::rename_property,
            commands::metadata::set_metadata_cells,
            commands::edit_menu::set_edit_menu_labels,
            commands::edit_menu::set_save_view_enabled,
            commands::views::get_views,
            commands::views::get_view_nodes,
            commands::views::create_view,
            commands::views::rename_view,
            commands::views::delete_view,
            commands::views::create_view_node,
            commands::views::update_view_node,
            commands::views::delete_view_node,
            commands::views::reorder_view_nodes,
            commands::database_view::query_library_files,
            commands::database_view::get_all_property_values,
            commands::database_view::set_file_metadata_array_add,
            commands::database_view::set_file_metadata_array_remove,
            commands::database_view::get_incomplete_files,
            commands::path_mapping::get_folder_tree,
            commands::path_mapping::set_folder_label,
            commands::path_mapping::clear_folder_label,
            commands::path_mapping::get_mapping_nodes,
            commands::path_mapping::set_folder_labels,
            commands::path_mapping::clear_folder_labels,
            commands::path_mapping::folders_named,
            commands::path_mapping::count_mapping_conflicts,
            commands::locations::exclude_folder,
            commands::locations::include_folder,
            commands::locations::get_excluded_folders,
            commands::locations::list_subfolders,
            commands::metadata::rename_property_value,
            commands::path_mapping::move_property_value,
            commands::files::get_location_properties,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
