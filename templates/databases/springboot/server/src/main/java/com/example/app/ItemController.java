package com.example.app;

import java.util.List;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * A worked example of the database layer: list and create rows. Copy the shape
 * for your own entities, or delete this file along with Item and
 * ItemRepository.
 */
@RestController
@RequestMapping("/api/items")
public class ItemController {

    private final ItemRepository items;

    public ItemController(ItemRepository items) {
        this.items = items;
    }

    public record ItemRequest(String name) {
    }

    @GetMapping
    public List<Item> list() {
        return items.findAll();
    }

    @PostMapping
    public ResponseEntity<?> create(@RequestBody ItemRequest request) {
        String name = request.name() == null ? "" : request.name().trim();
        if (name.isEmpty()) {
            return ResponseEntity.badRequest().body("name is required");
        }

        Item item = new Item();
        item.setName(name);
        return ResponseEntity.status(HttpStatus.CREATED).body(items.save(item));
    }
}
