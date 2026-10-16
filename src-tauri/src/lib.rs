pub mod appearance;
pub mod commands;
pub mod db;
pub mod edit_menu;
pub mod models;

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

            let pool = tauri::async_runtime::block_on(
                sqlx::sqlite::SqlitePoolOptions::new().connect_with(
                    sqlx::sqlite::SqliteConnectOptions::new()
                        .filename(app_data_dir.join("folderbase.db"))
                        .create_if_missing(true),
                ),
            )?;

            tauri::async_runtime::block_on(run_migrations(&pool))?;

            app.manage(pool);
            appearance::setup(app)?;
            // macOS routes Cmd-Z through the menu bar; elsewhere the frontend's shortcuts handle it
            #[cfg(target_os = "macos")]
            if let Some(menu) = app.menu() {
                edit_menu::install(app, &menu)?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::admin::clear_database,
            commands::admin::open_path,
            commands::admin::open_paths,
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
            commands::locations::get_locations,
            commands::locations::add_location,
            commands::locations::delete_location,
            commands::properties::get_properties,
            commands::properties::get_property_values,
            commands::properties::create_property,
            commands::properties::update_property_type,
            commands::properties::create_property_value,
            commands::properties::delete_property_value,
            commands::properties::delete_property,
            commands::metadata::rename_property,
            commands::metadata::set_metadata_cells,
            commands::edit_menu::set_edit_menu_labels,
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
            commands::locations::list_subfolders,
            commands::metadata::rename_property_value,
            commands::path_mapping::move_property_value,
            commands::files::get_location_properties,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
