package com.example.app;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

/**
 * A worked example of the storage layer: upload a file, list what's there, and
 * hand out a link to one. Copy the shape, or delete this file along with
 * StorageService.
 */
@RestController
@RequestMapping("/api/files")
public class FileController {

    private final StorageService storage;

    public FileController(StorageService storage) {
        this.storage = storage;
    }

    @PostMapping
    public ResponseEntity<?> upload(@RequestParam("file") MultipartFile file) throws IOException {
        if (file.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "file is required"));
        }

        // The name a browser sends is not unique and not always safe; the key is.
        String key = UUID.randomUUID() + "-" + file.getOriginalFilename();
        storage.put(key, file);
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(Map.of("key", key, "size", file.getSize()));
    }

    @GetMapping
    public List<Map<String, Object>> list() {
        return storage.list();
    }

    /**
     * A signed URL rather than the bytes: the browser fetches from the store
     * itself, the server never proxies the download, and the link expires.
     */
    @GetMapping("/{key}")
    public ResponseEntity<Void> download(@PathVariable String key) {
        return ResponseEntity.status(HttpStatus.FOUND).location(storage.presign(key)).build();
    }
}
