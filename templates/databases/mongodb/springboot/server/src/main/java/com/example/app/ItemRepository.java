package com.example.app;

import org.springframework.data.mongodb.repository.MongoRepository;

/**
 * Spring Data writes the implementation: findAll, save, deleteById and the
 * rest come for free, and method names like findByName become queries.
 */
public interface ItemRepository extends MongoRepository<Item, String> {
}
