package com.epicenter.hifi;

import android.os.Bundle;
import android.util.Log;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    // Registrar plugin ANTES de super.onCreate() para que Capacitor lo reconozca
    Log.d("MusicScanner", "MainActivity - registrando MusicScannerPlugin");
    try {
      registerPlugin(MusicScannerPlugin.class);
      Log.d("MusicScanner", "✅ Plugin registrado exitosamente");
    } catch (Exception e) {
      Log.e("MusicScanner", "❌ ERROR al registrar plugin: " + e.getMessage());
      e.printStackTrace();
    }
    
    super.onCreate(savedInstanceState);
  }
}
