mod common;

use folderbase_lib::commands::settings::{get_app_settings_impl, set_zip_folder_impl, zip_folder};
use std::path::Path;

#[tokio::test]
async fn zips_go_to_downloads_until_a_folder_is_chosen() {
    let pool = common::setup_db().await;
    let downloads = Path::new("/nowhere/Downloads");
    assert_eq!(get_app_settings_impl(&pool).await.unwrap().zip_folder, None);
    assert_eq!(zip_folder(&pool, downloads).await, downloads);

    let chosen = std::env::temp_dir();
    let chosen_text = chosen.to_string_lossy().into_owned();
    let settings = set_zip_folder_impl(&pool, Some(&chosen_text)).await.unwrap();
    assert_eq!(settings.zip_folder.as_deref(), Some(chosen_text.as_str()));
    assert_eq!(zip_folder(&pool, downloads).await, chosen);

    // Back to Downloads
    assert_eq!(set_zip_folder_impl(&pool, None).await.unwrap().zip_folder, None);
    assert_eq!(zip_folder(&pool, downloads).await, downloads);
}

#[tokio::test]
async fn only_a_folder_that_exists_can_be_chosen() {
    let pool = common::setup_db().await;
    assert!(set_zip_folder_impl(&pool, Some("/definitely/not/here")).await.is_err());
    assert!(set_zip_folder_impl(&pool, Some("relative/folder")).await.is_err());
    assert_eq!(get_app_settings_impl(&pool).await.unwrap().zip_folder, None);
}

#[tokio::test]
async fn a_chosen_folder_that_has_gone_falls_back_to_downloads() {
    let pool = common::setup_db().await;
    let gone = std::env::temp_dir().join(format!("folderbase-zips-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&gone).unwrap();
    set_zip_folder_impl(&pool, Some(&gone.to_string_lossy())).await.unwrap();
    std::fs::remove_dir(&gone).unwrap();
    let downloads = Path::new("/nowhere/Downloads");
    assert_eq!(zip_folder(&pool, downloads).await, downloads);
}
