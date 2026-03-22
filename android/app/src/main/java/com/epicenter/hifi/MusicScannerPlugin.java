package com.epicenter.hifi;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.File;
import java.io.FileOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

@CapacitorPlugin(
  name = "MusicScanner",
  permissions = {
    @Permission(alias = "audio33", strings = { Manifest.permission.READ_MEDIA_AUDIO }),
    @Permission(alias = "audioLegacy", strings = { Manifest.permission.READ_EXTERNAL_STORAGE })
  }
)
public class MusicScannerPlugin extends Plugin {

  // Directorio de caché para archivos de audio temporales
  private File getAudioCacheDir() {
    File cacheDir = new File(getContext().getCacheDir(), "audio_cache");
    if (!cacheDir.exists()) {
      cacheDir.mkdirs();
    }
    return cacheDir;
  }

  private String getAudioAlias() {
    return Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU ? "audio33" : "audioLegacy";
  }

  private boolean hasAudioPermission() {
    String alias = getAudioAlias();
    PermissionState capacitorState = getPermissionState(alias);
    
    int androidState;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        androidState = getContext().checkSelfPermission(Manifest.permission.READ_MEDIA_AUDIO);
    } else {
        androidState = getContext().checkSelfPermission(Manifest.permission.READ_EXTERNAL_STORAGE);
    }
    boolean androidGranted = androidState == android.content.pm.PackageManager.PERMISSION_GRANTED;
    
    return androidGranted || capacitorState == PermissionState.GRANTED;
  }

  @PluginMethod
  public void requestAudioPermissions(PluginCall call) {
    String alias = getAudioAlias();
    android.util.Log.d("MusicScanner", "Solicitando permisos para alias: " + alias);
    
    if (hasAudioPermission()) {
      android.util.Log.d("MusicScanner", "✅ Permiso ya concedido");
      JSObject result = new JSObject();
      result.put("granted", true);
      call.resolve(result);
    } else {
      android.util.Log.d("MusicScanner", "Solicitando permiso al usuario...");
      requestPermissionForAlias(alias, call, "permissionsCallback");
    }
  }

  @PermissionCallback
  public void permissionsCallback(PluginCall call) {
    boolean granted = hasAudioPermission();
    android.util.Log.d("MusicScanner", "Callback de permisos. Granted: " + granted);
    JSObject result = new JSObject();
    result.put("granted", granted);
    call.resolve(result);
  }

  @PluginMethod
  public void checkPermissions(PluginCall call) {
    boolean granted = hasAudioPermission();
    JSObject result = new JSObject();
    result.put("granted", granted);
    call.resolve(result);
  }

  @PluginMethod
  public void scanMusic(PluginCall call) {
    android.util.Log.d("MusicScanner", "==========================================");
    android.util.Log.d("MusicScanner", "scanMusic() llamado!");
    android.util.Log.d("MusicScanner", "==========================================");
    
    if (!hasAudioPermission()) {
      android.util.Log.e("MusicScanner", "❌ Permiso NO concedido");
      call.reject("Permission not granted");
      return;
    }

    android.util.Log.d("MusicScanner", "✅ Permiso concedido, iniciando escaneo...");

    try {
      JSArray musicFiles = scanMusicFromMediaStore();
      android.util.Log.d("MusicScanner", "✅ Escaneo completado. Archivos encontrados: " + musicFiles.length());
      
      JSObject result = new JSObject();
      result.put("files", musicFiles);
      result.put("count", musicFiles.length());
      call.resolve(result);
    } catch (Exception e) {
      android.util.Log.e("MusicScanner", "❌ Error en escaneo: " + e.getMessage());
      e.printStackTrace();
      call.reject("Error scanning music: " + e.getMessage(), e);
    }
  }

  /**
   * Copia el archivo de audio a la caché y devuelve una URL accesible
   * Este método es más eficiente para archivos grandes (FLAC, WAV, etc.)
   */
  @PluginMethod
  public void getAudioFileUrl(PluginCall call) {
    String contentUri = call.getString("contentUri");
    String trackId = call.getString("trackId");
    
    if (contentUri == null || contentUri.isEmpty()) {
      call.reject("contentUri is required");
      return;
    }
    
    if (trackId == null || trackId.isEmpty()) {
      trackId = String.valueOf(System.currentTimeMillis());
    }

    android.util.Log.d("MusicScanner", "getAudioFileUrl para: " + contentUri);

    try {
      Uri uri = Uri.parse(contentUri);
      ContentResolver resolver = getContext().getContentResolver();
      
      // Obtener el tipo MIME
      String mimeType = resolver.getType(uri);
      if (mimeType == null) {
        mimeType = "audio/mpeg";
      }
      
      // Determinar la extensión del archivo
      String extension = ".mp3";
      if (mimeType.contains("flac")) {
        extension = ".flac";
      } else if (mimeType.contains("wav")) {
        extension = ".wav";
      } else if (mimeType.contains("aiff")) {
        extension = ".aiff";
      } else if (mimeType.contains("m4a") || mimeType.contains("mp4")) {
        extension = ".m4a";
      } else if (mimeType.contains("ogg")) {
        extension = ".ogg";
      }
      
      // Crear archivo en caché
      File cacheDir = getAudioCacheDir();
      File outputFile = new File(cacheDir, "track_" + trackId + extension);
      
      // Si el archivo ya existe en caché, devolverlo directamente
      if (outputFile.exists()) {
        android.util.Log.d("MusicScanner", "✅ Archivo ya en caché: " + outputFile.getAbsolutePath());
        JSObject result = new JSObject();
        result.put("filePath", outputFile.getAbsolutePath());
        result.put("mimeType", mimeType);
        result.put("cached", true);
        call.resolve(result);
        return;
      }
      
      // Copiar archivo desde content:// a caché
      InputStream inputStream = resolver.openInputStream(uri);
      if (inputStream == null) {
        call.reject("Could not open audio file");
        return;
      }

      OutputStream outputStream = new FileOutputStream(outputFile);
      byte[] buffer = new byte[8192];
      int bytesRead;
      long totalBytes = 0;
      
      while ((bytesRead = inputStream.read(buffer)) != -1) {
        outputStream.write(buffer, 0, bytesRead);
        totalBytes += bytesRead;
      }
      
      inputStream.close();
      outputStream.close();

      android.util.Log.d("MusicScanner", "✅ Archivo copiado a caché: " + outputFile.getAbsolutePath() + " (" + totalBytes + " bytes)");

      JSObject result = new JSObject();
      result.put("filePath", outputFile.getAbsolutePath());
      result.put("mimeType", mimeType);
      result.put("size", totalBytes);
      result.put("cached", false);
      call.resolve(result);
    } catch (Exception e) {
      android.util.Log.e("MusicScanner", "❌ Error obteniendo audio: " + e.getMessage());
      e.printStackTrace();
      call.reject("Error getting audio: " + e.getMessage(), e);
    }
  }

  /**
   * Limpia la caché de archivos de audio
   */
  @PluginMethod
  public void clearAudioCache(PluginCall call) {
    try {
      File cacheDir = getAudioCacheDir();
      if (cacheDir.exists()) {
        File[] files = cacheDir.listFiles();
        if (files != null) {
          for (File file : files) {
            file.delete();
          }
        }
      }
      android.util.Log.d("MusicScanner", "✅ Caché de audio limpiada");
      JSObject result = new JSObject();
      result.put("success", true);
      call.resolve(result);
    } catch (Exception e) {
      call.reject("Error clearing cache: " + e.getMessage(), e);
    }
  }

  /**
   * Obtiene la carátula del álbum como data URL (las imágenes son pequeñas, está bien usar base64)
   */
  @PluginMethod
  public void getAlbumArt(PluginCall call) {
    String albumArtUri = call.getString("albumArtUri");
    if (albumArtUri == null || albumArtUri.isEmpty()) {
      JSObject result = new JSObject();
      result.put("dataUrl", (String) null);
      call.resolve(result);
      return;
    }

    try {
      Uri uri = Uri.parse(albumArtUri);
      ContentResolver resolver = getContext().getContentResolver();
      
      InputStream inputStream = resolver.openInputStream(uri);
      if (inputStream == null) {
        JSObject result = new JSObject();
        result.put("dataUrl", (String) null);
        call.resolve(result);
        return;
      }

      ByteArrayOutputStream byteBuffer = new ByteArrayOutputStream();
      byte[] buffer = new byte[4096];
      int len;
      while ((len = inputStream.read(buffer)) != -1) {
        byteBuffer.write(buffer, 0, len);
      }
      inputStream.close();

      byte[] imageBytes = byteBuffer.toByteArray();
      String base64Image = Base64.encodeToString(imageBytes, Base64.NO_WRAP);
      String dataUrl = "data:image/jpeg;base64," + base64Image;

      JSObject result = new JSObject();
      result.put("dataUrl", dataUrl);
      call.resolve(result);
    } catch (Exception e) {
      android.util.Log.w("MusicScanner", "No se pudo obtener carátula: " + e.getMessage());
      JSObject result = new JSObject();
      result.put("dataUrl", (String) null);
      call.resolve(result);
    }
  }

  private JSArray scanMusicFromMediaStore() {
    JSArray musicFiles = new JSArray();
    ContentResolver resolver = getContext().getContentResolver();

    Uri collection;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      collection = MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL);
    } else {
      collection = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI;
    }

    String[] projection = {
      MediaStore.Audio.Media._ID,
      MediaStore.Audio.Media.DISPLAY_NAME,
      MediaStore.Audio.Media.TITLE,
      MediaStore.Audio.Media.ARTIST,
      MediaStore.Audio.Media.ALBUM,
      MediaStore.Audio.Media.DURATION,
      MediaStore.Audio.Media.SIZE,
      MediaStore.Audio.Media.MIME_TYPE,
      MediaStore.Audio.Media.ALBUM_ID
    };

    // NO filtrar por IS_MUSIC para incluir archivos Hi-Res
    String selection = null;
    String sortOrder = MediaStore.Audio.Media.TITLE + " ASC";

    Cursor cursor = resolver.query(collection, projection, selection, null, sortOrder);

    if (cursor == null) {
      return musicFiles;
    }

    if (cursor.getCount() == 0) {
      cursor.close();
      return musicFiles;
    }

    try {
      int idColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media._ID);
      int nameColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DISPLAY_NAME);
      int titleColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE);
      int artistColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST);
      int albumColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM);
      int durationColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DURATION);
      int sizeColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.SIZE);
      int mimeColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.MIME_TYPE);
      int albumIdColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM_ID);

      while (cursor.moveToNext()) {
        long id = cursor.getLong(idColumn);
        String name = cursor.getString(nameColumn);
        String title = cursor.getString(titleColumn);
        String artist = cursor.getString(artistColumn);
        String album = cursor.getString(albumColumn);
        long duration = cursor.getLong(durationColumn);
        long size = cursor.getLong(sizeColumn);
        String mimeType = cursor.getString(mimeColumn);
        long albumId = cursor.getLong(albumIdColumn);

        // Filtrar solo archivos de audio válidos
        if (mimeType == null || !mimeType.startsWith("audio/")) {
          continue;
        }

        Uri contentUri = ContentUris.withAppendedId(collection, id);
        Uri albumArtUri = ContentUris.withAppendedId(
          Uri.parse("content://media/external/audio/albumart"),
          albumId
        );

        // Detectar si es Hi-Res basado en el formato
        boolean isHiRes = false;
        if (mimeType != null) {
          isHiRes = mimeType.contains("flac") || 
                    mimeType.contains("wav") || 
                    mimeType.contains("aiff") ||
                    mimeType.contains("alac") ||
                    mimeType.contains("dsd");
        }

        JSObject fileObj = new JSObject();
        fileObj.put("id", String.valueOf(id));
        fileObj.put("name", name != null ? name : "Unknown");
        fileObj.put("title", title != null && !title.isEmpty() ? title : (name != null ? name : "Unknown"));
        fileObj.put("artist", artist != null && !artist.isEmpty() ? artist : "Unknown Artist");
        fileObj.put("album", album != null && !album.isEmpty() ? album : "Unknown Album");
        fileObj.put("duration", duration / 1000);
        fileObj.put("size", size);
        fileObj.put("mimeType", mimeType != null ? mimeType : "audio/mpeg");
        fileObj.put("contentUri", contentUri.toString());
        fileObj.put("albumArtUri", albumArtUri.toString());
        fileObj.put("isHiRes", isHiRes);

        musicFiles.put(fileObj);
      }
    } finally {
      cursor.close();
    }

    return musicFiles;
  }
}
