#!/bin/bash

# Check if the correct number of parameters is provided
if [ "$#" -ne 2 ]; then
    echo "Usage: $0 <commit-message> <branch-name>"
    exit 1
fi

# Assign parameters to variables
COMMIT_MESSAGE=$1
BRANCH_NAME=$2

# Ensure Git is using the credential helper for HTTPS
git config --global credential.helper store

# Check if the branch exists
BRANCH_EXISTS=$(git branch --list "$BRANCH_NAME")

if [ -z "$BRANCH_EXISTS" ]; then
    echo "Branch '$BRANCH_NAME' does not exist. Creating it now..."
    git checkout -b "$BRANCH_NAME"
    if [ $? -ne 0 ]; then
        echo "Failed to create branch '$BRANCH_NAME'."
        exit 1
    fi
else
    echo "Branch '$BRANCH_NAME' exists. Checking it out..."
    git checkout "$BRANCH_NAME"
    if [ $? -ne 0 ]; then
        echo "Failed to checkout branch '$BRANCH_NAME'."
        exit 1
    fi
fi

# Check if there are any changes to commit
if git diff --quiet; then
    echo "No changes to commit."
    exit 0
fi

# Perform git operations
echo "Adding all changes..."
git add .
if [ $? -ne 0 ]; then
    echo "Failed to add changes."
    exit 1
fi

echo "Committing changes with message: $COMMIT_MESSAGE"
git commit -m "$COMMIT_MESSAGE"
if [ $? -ne 0 ]; then
    echo "Commit failed."
    exit 1
fi

echo "Pushing changes forcefully to branch: $BRANCH_NAME"
# Set GIT_ASKPASS to bypass the password prompt using the stored credentials
export GIT_ASKPASS=echo
git push -f origin "$BRANCH_NAME"
if [ $? -ne 0 ]; then
    echo "Push failed."
    exit 1
fi

echo "Git operations completed successfully."