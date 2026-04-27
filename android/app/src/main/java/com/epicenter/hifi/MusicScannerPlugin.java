package com.epicenter.hifi;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.database.Cursor;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.util.Base64;
import android.content.SharedPreferences;

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
import java.security.MessageDigest;
import java.util.Locale;

@CapacitorPlugin(
  name = "MusicScanner",
  permissions = {
    @Permission(alias = "audio33", strings = { Manifest.permission.READ_MEDIA_AUDIO }),
    @Permission(alias = "audioLegacy", strings = { Manifest.permission.READ_EXTERNAL_STORAGE })
  }
)
public class MusicScannerPlugin extends Plugin {
  private static final String LIBRARY_PREFS = "epicenter_library_store";
  private static final String LIBRARY_SNAPSHOT_KEY = "library_snapshot_json";

  private static class AudioFormatInfo {
    Integer bitDepth;
    Integer sampleRate;
    Integer bitrate;
  }

  private AudioFormatInfo getAudioFormatInfo(Uri contentUri) {
    AudioFormatInfo info = new AudioFormatInfo();
    MediaMetadataRetriever retriever = new MediaMetadataRetriever();
    MediaExtractor extractor = new MediaExtractor();

    try {
      retriever.setDataSource(getContext(), contentUri);
      String bitrateValue = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_BITRATE);
      if (bitrateValue != null && !bitrateValue.isEmpty()) {
        info.bitrate = Integer.parseInt(bitrateValue);
      }
    } catch (Exception ignored) {
    }

    try {
      extractor.setDataSource(getContext(), contentUri, null);
      for (int i = 0; i < extractor.getTrackCount(); i++) {
        MediaFormat format = extractor.getTrackFormat(i);
        String mime = format.getString(MediaFormat.KEY_MIME);
        if (mime == null || !mime.startsWith("audio/")) {
          continue;
        }

        if (format.containsKey(MediaFormat.KEY_SAMPLE_RATE)) {
          info.sampleRate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE);
        }

        if (info.bitrate == null && format.containsKey(MediaFormat.KEY_BIT_RATE)) {
          info.bitrate = format.getInteger(MediaFormat.KEY_BIT_RATE);
        }

        if (format.containsKey("bits-per-sample")) {
          info.bitDepth = format.getInteger("bits-per-sample");
        }
        break;
      }
    } catch (Exception ignored) {
    } finally {
      try {
        retriever.release();
      } catch (Exception ignored) {
      }
      try {
        extractor.release();
      } catch (Exception ignored) {
      }
    }

    return info;
  }

  @PluginMethod
  public void saveLibrarySnapshot(PluginCall call) {
    String payload = call.getString("payload", "[]");
    try {
      SharedPreferences prefs = getContext().getSharedPreferences(LIBRARY_PREFS, android.content.Context.MODE_PRIVATE);
      prefs.edit().putString(LIBRARY_SNAPSHOT_KEY, payload).apply();
      JSObject result = new JSObject();
      result.put("success", true);
      call.resolve(result);
    } catch (Exception e) {
      call.reject("Error saving library snapshot: " + e.getMessage(), e);
    }
  }

  @PluginMethod
  public void loadLibrarySnapshot(PluginCall call) {
    try {
      SharedPreferences prefs = getContext().getSharedPreferences(LIBRARY_PREFS, android.content.Context.MODE_PRIVATE);
      String payload = prefs.getString(LIBRARY_SNAPSHOT_KEY, "[]");
      JSObject result = new JSObject();
      result.put("payload", payload);
      call.resolve(result);
    } catch (Exception e) {
      call.reject("Error loading library snapshot: " + e.getMessage(), e);
    }
  }

  @PluginMethod
  public void clearLibrarySnapshot(PluginCall call) {
    try {
      SharedPreferences prefs = getContext().getSharedPreferences(LIBRARY_PREFS, android.content.Context.MODE_PRIVATE);
      prefs.edit().remove(LIBRARY_SNAPSHOT_KEY).apply();
      JSObject result = new JSObject();
      result.put("success", true);
      call.resolve(result);
    } catch (Exception e) {
      call.reject("Error clearing library snapshot: " + e.getMessage(), e);
    }
  }

  // Directorio de caché para archivos de audio temporales
  private File getAudioCacheDir() {
    File cacheDir = new File(getContext().getCacheDir(), "audio_cache");
    if (!cacheDir.exists()) {
      cacheDir.mkdirs();
    }
    return cacheDir;
  }

  private File getManualImportsDir() {
    File importsDir = new File(getContext().getFilesDir(), "manual_imports");
    if (!importsDir.exists()) {
      importsDir.mkdirs();
    }
    return importsDir;
  }

  @PluginMethod
  public void importManualTrack(PluginCall call) {
    String fileName = call.getString("fileName");
    String mimeType = call.getString("mimeType", "audio/mpeg");
    String base64Data = call.getString("base64Data");

    if (fileName == null || fileName.isEmpty()) {
      call.reject("fileName is required");
      return;
    }
    if (base64Data == null || base64Data.isEmpty()) {
      call.reject("base64Data is required");
      return;
    }

    try {
      String extension = ".mp3";
      int dot = fileName.lastIndexOf('.');
      if (dot >= 0 && dot < fileName.length() - 1) {
        extension = fileName.substring(dot).toLowerCase(Locale.US);
      }

      String normalizedPayload = base64Data;
      int comma = normalizedPayload.indexOf(',');
      if (comma >= 0) {
        normalizedPayload = normalizedPayload.substring(comma + 1);
      }

      byte[] audioBytes = Base64.decode(normalizedPayload, Base64.DEFAULT);
      if (audioBytes.length == 0) {
        call.reject("decoded file is empty");
        return;
      }

      String identity = fileName + "|" + audioBytes.length + "|" + mimeType;
      String hash = sha1(identity);
      File output = new File(getManualImportsDir(), "manual_" + hash + extension);

      if (!output.exists() || output.length() != audioBytes.length) {
        FileOutputStream fos = new FileOutputStream(output, false);
        fos.write(audioBytes);
        fos.flush();
        fos.close();
      }

      JSObject result = new JSObject();
      result.put("filePath", output.getAbsolutePath());
      result.put("size", output.length());
      result.put("mimeType", mimeType);
      call.resolve(result);
    } catch (Exception e) {
      call.reject("Error importing manual track: " + e.getMessage(), e);
    }
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
    String sourceVersionKey = call.getString("sourceVersionKey");
    Long expectedSize = call.getLong("expectedSize");
    
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
      
      String cacheIdentity = contentUri + "|" + (sourceVersionKey != null ? sourceVersionKey : trackId);
      String cacheHash = sha1(cacheIdentity);

      // Crear archivo en caché
      File cacheDir = getAudioCacheDir();
      File outputFile = new File(cacheDir, "track_" + cacheHash + extension);
      File tempFile = new File(cacheDir, "track_" + cacheHash + extension + ".tmp");
      
      // Si el archivo ya existe en caché, devolverlo directamente
      if (outputFile.exists()) {
        if (outputFile.length() == 0 || (expectedSize != null && expectedSize > 0 && outputFile.length() != expectedSize)) {
          outputFile.delete();
        } else {
        android.util.Log.d("MusicScanner", "✅ Archivo ya en caché: " + outputFile.getAbsolutePath());
        JSObject result = new JSObject();
        result.put("filePath", outputFile.getAbsolutePath());
        result.put("mimeType", mimeType);
        result.put("cached", true);
        call.resolve(result);
        return;
        }
      }
      
      // Copiar archivo desde content:// a caché
      InputStream inputStream = resolver.openInputStream(uri);
      if (inputStream == null) {
        call.reject("Could not open audio file");
        return;
      }

      if (tempFile.exists()) {
        tempFile.delete();
      }

      OutputStream outputStream = new FileOutputStream(tempFile);
      byte[] buffer = new byte[8192];
      int bytesRead;
      long totalBytes = 0;
      
      while ((bytesRead = inputStream.read(buffer)) != -1) {
        outputStream.write(buffer, 0, bytesRead);
        totalBytes += bytesRead;
      }
      
      inputStream.close();
      outputStream.close();

      if (totalBytes <= 0) {
        tempFile.delete();
        call.reject("Copied file is empty");
        return;
      }

      if (expectedSize != null && expectedSize > 0 && totalBytes != expectedSize) {
        tempFile.delete();
        call.reject("Copied file size mismatch");
        return;
      }

      if (outputFile.exists()) {
        outputFile.delete();
      }

      if (!tempFile.renameTo(outputFile)) {
        tempFile.delete();
        call.reject("Could not finalize cached file");
        return;
      }

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

  private String sha1(String value) {
    try {
      MessageDigest md = MessageDigest.getInstance("SHA-1");
      byte[] digest = md.digest(value.getBytes());
      StringBuilder sb = new StringBuilder();
      for (byte b : digest) {
        sb.append(String.format("%02x", b));
      }
      return sb.toString();
    } catch (Exception e) {
      return String.valueOf(value.hashCode());
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
      MediaStore.Audio.Media.ALBUM_ID,
      MediaStore.Audio.Media.DATE_MODIFIED
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
      int dateModifiedColumn = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DATE_MODIFIED);

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
        long dateModified = cursor.getLong(dateModifiedColumn);

        // Filtrar solo archivos de audio válidos
        if (mimeType == null || !mimeType.startsWith("audio/")) {
          continue;
        }

        Uri contentUri = ContentUris.withAppendedId(collection, id);
        Uri albumArtUri = ContentUris.withAppendedId(
          Uri.parse("content://media/external/audio/albumart"),
          albumId
        );
        AudioFormatInfo formatInfo = getAudioFormatInfo(contentUri);

        // Detectar si es Hi-Res basado en el formato
        boolean isHiRes = false;
        if (formatInfo.bitDepth != null && formatInfo.sampleRate != null) {
          isHiRes = formatInfo.bitDepth >= 16 && formatInfo.sampleRate >= 44100;
        } else if (mimeType != null) {
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
        fileObj.put("dateModified", dateModified);
        fileObj.put("sourceVersionKey", id + ":" + size + ":" + dateModified);
        if (formatInfo.bitDepth != null) fileObj.put("bitDepth", formatInfo.bitDepth);
        if (formatInfo.sampleRate != null) fileObj.put("sampleRate", formatInfo.sampleRate);
        if (formatInfo.bitrate != null) fileObj.put("bitrate", formatInfo.bitrate);
        fileObj.put("isHiRes", isHiRes);

        musicFiles.put(fileObj);
      }
    } finally {
      cursor.close();
    }

    return musicFiles;
  }
}
